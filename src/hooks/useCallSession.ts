import { useCallback, useEffect, useRef, useState } from 'react';
import { botApi } from '@/api/bot';
import { ApiError } from '@/api/client';
import { useTRTC } from '@/hooks/useTRTC';

export type CallState =
  | { kind: 'loading' }
  | { kind: 'online' }
  // RESERVED 和 BUSY 对用户都只是"机器人繁忙"，不区分（按文档要求）
  // from 标记 busy 的触发来源：'status' = 查询状态接口返回；'connect' = 点击呼叫时 connect 失败
  | { kind: 'busy'; from: 'status' | 'connect' }
  | { kind: 'offline'; reason: 'not_found' | 'expired' }
  | { kind: 'error'; message: string }
  | { kind: 'modalOpen' }
  | { kind: 'reserving' }
  // deadline 可能为 null（BUSY 同名重连场景），UI 据此决定是否显示倒计时
  | { kind: 'waiting'; roomId: string; deadline: number | null }
  | { kind: 'calling'; roomId: string; startedAt: number }
  | { kind: 'timeout' }
  | { kind: 'ended' };

export interface UseCallSessionResult {
  state: CallState;
  trtc: ReturnType<typeof useTRTC>;
  refreshStatus: () => Promise<void>;
  openNicknameModal: () => void;
  closeNicknameModal: () => void;
  startCall: (userName: string) => Promise<void>;
  cancelWaiting: () => Promise<void>;
  hangup: () => Promise<void>;
  retry: () => void;
}

const userNameKey = (botUserId: string) => `rtc:userName:${botUserId}`;

/**
 * 用户呼叫的状态机。封装与撮合服务端的交互、TRTC 入退房、远端事件订阅。
 */
export function useCallSession(botUserId: string): UseCallSessionResult {
  const trtc = useTRTC();
  const [state, setState] = useState<CallState>({ kind: 'loading' });

  const cleanupRef = useRef<(() => Promise<void>) | null>(null);
  const deadlineTimerRef = useRef<number | undefined>(undefined);
  const inFlightRef = useRef<boolean>(false);

  const clearDeadlineTimer = () => {
    if (deadlineTimerRef.current !== undefined) {
      window.clearTimeout(deadlineTimerRef.current);
      deadlineTimerRef.current = undefined;
    }
  };

  /** 退房本地资源 */
  const runCleanup = useCallback(async () => {
    const fn = cleanupRef.current;
    cleanupRef.current = null;
    if (fn) await fn();
  }, []);

  const refreshStatus = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const info = await botApi.getStatus(botUserId);
      // RESERVED 和 BUSY 对用户都只是"忙"，不区分
      setState(info.status === 'IDLE' ? { kind: 'online' } : { kind: 'busy', from: 'status' });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 7404) {
          setState({ kind: 'offline', reason: 'not_found' });
          return;
        }
        if (e.code === 7410) {
          setState({ kind: 'offline', reason: 'expired' });
          return;
        }
      }
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'Network error' });
    }
  }, [botUserId]);

  // 初次加载与切换 botUserId 时拉取状态
  useEffect(() => {
    void refreshStatus();
    return () => {
      void runCleanup();
      clearDeadlineTimer();
    };
  }, [refreshStatus, runCleanup]);

  const openNicknameModal = useCallback(() => {
    // online 与 busy 都允许发起呼叫；能不能加入由 connect 的结果决定
    // (busy 时若是同 userName 重连，server 会返回 200 + 同 roomId)
    setState((prev) =>
      prev.kind === 'online' || prev.kind === 'busy' ? { kind: 'modalOpen' } : prev
    );
  }, []);

  const closeNicknameModal = useCallback(() => {
    // 关闭弹窗后回到服务端真实状态（可能是 online 也可能是 busy；不假设）
    setState((prev) => (prev.kind === 'modalOpen' ? { kind: 'loading' } : prev));
    void refreshStatus();
  }, [refreshStatus]);

  function handleConnectError(e: unknown) {
    if (e instanceof ApiError) {
      switch (e.code) {
        case 7409:
          setState({ kind: 'busy', from: 'connect' });
          return;
        case 7404:
          setState({ kind: 'offline', reason: 'not_found' });
          return;
        case 7410:
          setState({ kind: 'offline', reason: 'expired' });
          return;
        case 7400:
          setState({ kind: 'error', message: e.message });
          return;
      }
    }
    setState({ kind: 'error', message: e instanceof Error ? e.message : 'Unknown error' });
  }

  const startCall = useCallback(
    async (userName: string) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        // 失败重试场景：上次还没清干净的 trtc 资源先释放
        if (cleanupRef.current) {
          await runCleanup();
        }
        setState({ kind: 'reserving' });

        let connect: Awaited<ReturnType<typeof botApi.connect>>;
        try {
          connect = await botApi.connect(botUserId, userName);
        } catch (e) {
          handleConnectError(e);
          return;
        }

        // 防御性检查：busy 场景下若服务端没有返回房间凭据，直接回退到 busy 提示
        // （正常服务端在成功 envelope 里一定带 roomId/userId/userSig；这里兜底防止协议外的边界态）
        if (!connect.roomId || !connect.userId || !connect.userSig) {
          setState({ kind: 'busy', from: 'connect' });
          return;
        }

        // 持久化 userName 用于重连（同一会话内）
        try {
          sessionStorage.setItem(userNameKey(botUserId), userName);
        } catch {
          /* ignore */
        }

        const roomId = connect.roomId;
        cleanupRef.current = async () => {
          try {
            await trtc.exitRoom();
          } catch {
            /* ignore */
          }
        };

        try {
          await trtc.enterRoom({
            sdkAppId: connect.sdkAppId,
            userId: connect.userId,
            userSig: connect.userSig,
            roomId: connect.roomId,
          });
          await trtc.startLocalAudio();
        } catch (e) {
          await runCleanup();
          setState({
            kind: 'error',
            message: e instanceof Error ? e.message : 'Enter room failed',
          });
          return;
        }

        // status='BUSY' = 同名重连成功；bot 已经在房间里，REMOTE_USER_ENTER 会立刻触发 → 自动切 calling
        // status='RESERVED' = 首次抢占；等 bot 进房（最多 reservationDeadline）
        setState({
          kind: 'waiting',
          roomId,
          deadline: connect.reservationDeadline,
        });

        // 仅当 deadline 存在时设倒计时（BUSY 重连返回 null）
        clearDeadlineTimer();
        if (connect.reservationDeadline !== null) {
          const remaining = Math.max(0, connect.reservationDeadline - Date.now());
          deadlineTimerRef.current = window.setTimeout(async () => {
            // 文档：reservationDeadline 是参考值，不要硬阻断；只给用户一个明确反馈
            setState((prev) => (prev.kind === 'waiting' ? { kind: 'timeout' } : prev));
            await runCleanup();
          }, remaining);
        }
      } finally {
        inFlightRef.current = false;
      }
    },
    [botUserId, trtc, runCleanup]
  );

  // waiting → calling: 远端到达
  useEffect(() => {
    if (state.kind !== 'waiting') return;
    if (!trtc.remoteUserPresent) return;
    setState((prev) => {
      if (prev.kind !== 'waiting') return prev;
      clearDeadlineTimer();
      return { kind: 'calling', roomId: prev.roomId, startedAt: Date.now() };
    });
  }, [state.kind, trtc.remoteUserPresent]);

  const endByRemote = useCallback(async () => {
    setState({ kind: 'ended' });
    await runCleanup();
    setTimeout(() => {
      void refreshStatus();
    }, 500);
  }, [runCleanup, refreshStatus]);

  // calling → ended: 远端离开（bot 主动退或被踢）
  useEffect(() => {
    if (state.kind !== 'calling') return;
    if (trtc.remoteUserPresent) return;
    void endByRemote();
  }, [state.kind, trtc.remoteUserPresent, endByRemote]);

  const cancelWaiting = useCallback(async () => {
    if (state.kind !== 'waiting') return;
    clearDeadlineTimer();
    await runCleanup();
    setState({ kind: 'ended' });
    setTimeout(() => {
      void refreshStatus();
    }, 200);
  }, [state.kind, runCleanup, refreshStatus]);

  const hangup = useCallback(async () => {
    await runCleanup();
    setState({ kind: 'ended' });
    setTimeout(() => {
      void refreshStatus();
    }, 200);
  }, [runCleanup, refreshStatus]);

  const retry = useCallback(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // 关页 / 刷新：仅本地 trtc.exitRoom；不再发 HTTP（新协议无对应端点）
  // TRTC keep-alive 30~90s 后会触发 webhook 104，服务端 cron 自动回收 bot
  useEffect(() => {
    const handler = () => {
      if (state.kind === 'waiting' || state.kind === 'calling') {
        // best effort，浏览器卸载期间不能 await
        try {
          void trtc.exitRoom();
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state, trtc]);

  return {
    state,
    trtc,
    refreshStatus,
    openNicknameModal,
    closeNicknameModal,
    startCall,
    cancelWaiting,
    hangup,
    retry,
  };
}
