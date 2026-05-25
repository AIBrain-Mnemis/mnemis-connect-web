import { useRef, useState, useCallback, useEffect } from 'react';
import TRTC from 'trtc-sdk-v5';
import { useAppStore } from '@/store';

export type RoomStatus = 'idle' | 'entering' | 'entered' | 'exiting';
export type MediaStatus = 'idle' | 'starting' | 'started' | 'stopping';

export interface EnterRoomParams {
  sdkAppId: number;
  userId: string;
  userSig: string;
  roomId: string;
}

/**
 * TRTC 生命周期管理 Hook。
 * 与撮合服务无关 —— sig 由外部注入；本 Hook 只关心 TRTC SDK 自身。
 */
export function useTRTC() {
  const trtcRef = useRef<any>(null);

  const [roomStatus, setRoomStatus] = useState<RoomStatus>('idle');
  const [micStatus, setMicStatus] = useState<MediaStatus>('idle');
  const [shareStatus, setShareStatus] = useState<MediaStatus>('idle');
  const [audioMuted, setAudioMuted] = useState(false);
  // 是否有远端用户在房间内（驱动上层 waiting → calling 切换；用 SDK 事件直接维护，不依赖注册时序）
  const [remoteUserPresent, setRemoteUserPresent] = useState(false);

  // Initialize TRTC instance once per Hook instance
  useEffect(() => {
    if (!trtcRef.current) {
      trtcRef.current = TRTC.create();
      TRTC.setLogLevel(1);
    }
    return () => {
      const trtc = trtcRef.current;
      if (!trtc) return;
      trtcRef.current = null;
      // SDK 要求 destroy 之前先 leave；HMR / 导航离开时若仍在房间，必须先退房。
      // useEffect cleanup 不能 async，故用 fire-and-forget；destroy 也兜底吞错。
      Promise.resolve()
        .then(() => trtc.exitRoom())
        .catch(() => {
          /* not in a room is fine */
        })
        .then(() => trtc.destroy())
        .catch(() => {
          /* already destroyed is fine */
        });
    };
  }, []);

  const bindEvents = useCallback(() => {
    const trtc = trtcRef.current;
    if (!trtc) return;

    // 任一远端到达信号都翻 remoteUserPresent；监听必须在 enterRoom resolve 之前注册
    // 否则（Bot 比 web 早入房时）这个事件会丢失，web 端会卡在 waiting 直到 deadline。
    trtc.on(TRTC.EVENT.REMOTE_USER_ENTER, () => {
      setRemoteUserPresent(true);
    });
    trtc.on(TRTC.EVENT.REMOTE_USER_EXIT, () => {
      setRemoteUserPresent(false);
    });

    trtc.on(
      TRTC.EVENT.REMOTE_VIDEO_AVAILABLE,
      ({ userId, streamType }: { userId: string; streamType: string }) => {
        const elementId = `${userId}_${streamType}`;
        // 兜底：极少情况下 USER_ENTER 可能先于本监听被注册（理论上不应发生），
        // 此处仍把 remoteUserPresent 标 true，确保 waiting 一定能推进
        setRemoteUserPresent(true);
        // 先入 store -> React 渲染 div -> setTimeout(0) 让 SDK 在 div 存在后再订阅
        useAppStore.getState().addRemoteUser({ userId, streamType, elementId });
        setTimeout(() => {
          trtc.startRemoteVideo({ userId, streamType, view: elementId });
        }, 0);
      }
    );

    trtc.on(
      TRTC.EVENT.REMOTE_VIDEO_UNAVAILABLE,
      ({ userId, streamType }: { userId: string; streamType: string }) => {
        const elementId = `${userId}_${streamType}`;
        useAppStore.getState().removeRemoteUser(elementId);
        trtc.stopRemoteVideo({ userId, streamType });
      }
    );

    // 用户在浏览器上点 "Stop sharing" 时也会触发，这里把本地状态拉回 idle
    trtc.on(TRTC.EVENT.SCREEN_SHARE_STOPPED, () => {
      setShareStatus('idle');
      useAppStore.getState().addSuccessLog('Screen sharing stopped.');
    });
  }, []);

  const unbindEvents = useCallback(() => {
    const trtc = trtcRef.current;
    if (!trtc) return;
    trtc.off('*');
    setRemoteUserPresent(false);
  }, []);

  const enterRoom = useCallback(
    async (params: EnterRoomParams) => {
      const { sdkAppId, userId, userSig, roomId } = params;
      if (!sdkAppId || !userId || !userSig || !roomId) {
        throw new Error('enterRoom: missing required params');
      }
      setRoomStatus('entering');
      bindEvents();
      try {
        await trtcRef.current.enterRoom({
          strRoomId: roomId,
          sdkAppId,
          userId,
          userSig,
        });
        useAppStore.getState().addSuccessLog(`[${userId}] enterRoom.`);
        setRoomStatus('entered');
      } catch (error: any) {
        console.error('enterRoom error', error);
        useAppStore
          .getState()
          .addFailedLog(`[${userId}] enterRoom failed. Reason: ${error?.message || error}`);
        setRoomStatus('idle');
        unbindEvents();
        throw error;
      }
    },
    [bindEvents, unbindEvents]
  );

  const exitRoom = useCallback(async () => {
    setRoomStatus('exiting');
    try {
      // 不依赖 React state（micStatus/shareStatus 异步更新，cleanup 可能早于 setMicStatus('started') flush）
      // SDK 的 stop 方法是幂等的：未启动时调用会立刻 resolve（或抛 not-started 错），都吞掉
      try {
        await trtcRef.current.stopLocalAudio();
      } catch {
        /* not started or aborted */
      }
      try {
        await trtcRef.current.stopScreenShare();
      } catch {
        /* not started */
      }
      setMicStatus('idle');
      setShareStatus('idle');

      await trtcRef.current.exitRoom();
      useAppStore.getState().addSuccessLog('exitRoom.');
      useAppStore.getState().clearRemoteUsers();
      unbindEvents();
      setRoomStatus('idle');
      setAudioMuted(false);
    } catch (error: any) {
      console.error('exitRoom error', error);
      useAppStore.getState().addFailedLog(`exitRoom failed. Reason: ${error?.message || error}`);
      // 即便失败，也回到 idle 让上层不会被卡住
      setRoomStatus('idle');
      setMicStatus('idle');
      setShareStatus('idle');
    }
  }, [unbindEvents]);

  const startLocalAudio = useCallback(async (microphoneId?: string) => {
    setMicStatus('starting');
    try {
      await trtcRef.current.startLocalAudio({
        option: microphoneId ? { microphoneId } : undefined,
      });
      setMicStatus('started');
      setAudioMuted(false);
      useAppStore.getState().addSuccessLog('startLocalAudio.');
    } catch (error: any) {
      // API_CALL_ABORTED (0x404d) = publish 被 exitRoom/stopLocalAudio 打断；属正常生命周期事件，不应阻塞调用方
      const aborted =
        error?.code === 0x404d ||
        error?.code === 'ERR_API_CALL_ABORTED' ||
        String(error?.message || '')
          .toLowerCase()
          .includes('aborted');
      if (aborted) {
        console.warn('startLocalAudio aborted (likely by concurrent exit/stop)', error);
        useAppStore.getState().addFailedLog('startLocalAudio aborted (benign).');
        setMicStatus('idle');
        return; // 不再 throw，让上层正常推进 / 等待真正的退房逻辑
      }
      console.error('startLocalAudio error', error);
      useAppStore
        .getState()
        .addFailedLog(`startLocalAudio failed. Reason: ${error?.message || error}`);
      setMicStatus('idle');
      throw error;
    }
  }, []);

  const stopLocalAudio = useCallback(async () => {
    if (micStatus !== 'started') return;
    setMicStatus('stopping');
    try {
      await trtcRef.current.stopLocalAudio();
      setMicStatus('idle');
      useAppStore.getState().addSuccessLog('stopLocalAudio.');
    } catch (error: any) {
      console.error('stopLocalAudio error', error);
      useAppStore
        .getState()
        .addFailedLog(`stopLocalAudio failed. Reason: ${error?.message || error}`);
      setMicStatus('started');
    }
  }, [micStatus]);

  const startScreenShare = useCallback(async () => {
    setShareStatus('starting');
    try {
      await trtcRef.current.startScreenShare();
      setShareStatus('started');
      useAppStore.getState().addSuccessLog('startScreenShare.');
    } catch (error: any) {
      // 用户取消选择窗口也会落到这里；不再 throw 给上层（属于正常用户操作）
      console.error('startScreenShare error', error);
      useAppStore
        .getState()
        .addFailedLog(`startScreenShare failed. Reason: ${error?.message || error}`);
      setShareStatus('idle');
    }
  }, []);

  const stopScreenShare = useCallback(async () => {
    if (shareStatus !== 'started') return;
    setShareStatus('stopping');
    try {
      await trtcRef.current.stopScreenShare();
      setShareStatus('idle');
      useAppStore.getState().addSuccessLog('stopScreenShare.');
    } catch (error: any) {
      console.error('stopScreenShare error', error);
      useAppStore
        .getState()
        .addFailedLog(`stopScreenShare failed. Reason: ${error?.message || error}`);
      setShareStatus('started');
    }
  }, [shareStatus]);

  const toggleAudioMute = useCallback(async () => {
    try {
      const newMuted = !audioMuted;
      await trtcRef.current.updateLocalAudio({ mute: newMuted });
      setAudioMuted(newMuted);
      useAppStore.getState().addSuccessLog(`updateLocalAudio muted=${newMuted}`);
    } catch (error: any) {
      useAppStore
        .getState()
        .addFailedLog(`updateLocalAudio failed. Reason: ${error?.message || error}`);
    }
  }, [audioMuted]);

  // 通用事件订阅；返回卸载函数。上层用此监听 REMOTE_USER_ENTER / REMOTE_USER_LEAVE 等
  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    const trtc = trtcRef.current;
    if (!trtc) return () => {};
    trtc.on(event, handler);
    return () => trtc.off(event, handler);
  }, []);

  return {
    trtcRef,
    roomStatus,
    micStatus,
    shareStatus,
    audioMuted,
    remoteUserPresent,

    enterRoom,
    exitRoom,
    startLocalAudio,
    stopLocalAudio,
    startScreenShare,
    stopScreenShare,
    toggleAudioMute,

    on,
  };
}

// 暴露 SDK 静态成员，方便上层使用 TRTC.EVENT 而不重复 import
export { default as TRTC } from 'trtc-sdk-v5';
