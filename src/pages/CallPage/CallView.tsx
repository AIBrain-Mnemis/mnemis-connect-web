import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Bot,
  Wifi,
  Activity,
  ShieldAlert,
} from 'lucide-react';
import { Avatar, AvatarBadge, AvatarFallback } from '@/components/ui/avatar';
import { ControlButton } from '@/components/ui/control-button';
import { useAppStore } from '@/store';
import { cn } from '@/lib/utils';
import type { MediaStatus } from '@/hooks/useTRTC';

interface CallViewProps {
  botId: string;
  userName: string;
  /** true 表示还没等到对端进入房间（waiting 状态） */
  connecting: boolean;
  /** 通话开始时间戳，用于显示时长。waiting 时为 null。 */
  startedAt: number | null;
  /** 预约截止时间（用于 waiting 时的倒计时提示）。可能为 null。 */
  deadline: number | null;
  audioMuted: boolean;
  shareStatus: MediaStatus;
  remoteUserPresent: boolean;
  onToggleAudio: () => void;
  onToggleShare: () => void;
  onHangup: () => void;
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const SCREEN_FRAME_CLASS =
  'relative aspect-video w-full max-w-4xl overflow-hidden rounded-2xl bg-gray-800 shadow-2xl flex items-center justify-center transition-all duration-500';

export default function CallView({
  botId,
  userName,
  connecting,
  startedAt,
  deadline,
  audioMuted,
  shareStatus,
  remoteUserPresent,
  onToggleAudio,
  onToggleShare,
  onHangup,
}: CallViewProps) {
  const { t } = useTranslation();
  const remoteUsers = useAppStore((s) => s.remoteUsers);

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (startedAt === null) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const [waitRemaining, setWaitRemaining] = useState<number | null>(() =>
    deadline === null ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
  );
  useEffect(() => {
    if (deadline === null) {
      setWaitRemaining(null);
      return;
    }
    const tick = () => setWaitRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [deadline]);

  const isUserSharing = shareStatus === 'started';
  const shareBusy = shareStatus === 'starting' || shareStatus === 'stopping';
  // 远端是否在分享屏幕：检测 remoteUsers 中是否有 streamType='sub'（screen share 子流）
  const botRemoteSub = remoteUsers.find((u) => u.streamType === 'sub');
  const isBotSharing = !!botRemoteSub;

  const headerSubtitle = connecting
    ? waitRemaining !== null
      ? t('call.waiting.remaining', { seconds: waitRemaining })
      : t('call.waiting.title')
    : t('call.statusOnline');

  return (
    <div className="flex h-screen w-full flex-col bg-gray-900 animate-in fade-in duration-300">
      {/* 顶部信息栏 */}
      <header className="absolute inset-x-0 top-0 z-10 p-4">
        <div className="relative flex items-center justify-between text-white">
          <div className="flex items-center gap-3">
            <Avatar size="lg" className="border border-gray-700/50 bg-gray-800/80 after:hidden">
              <AvatarFallback className="bg-transparent text-gray-500">
                <Bot className="size-5" />
              </AvatarFallback>
              <AvatarBadge
                className={cn(
                  'ring-gray-900',
                  remoteUserPresent ? 'bg-emerald-500' : 'animate-pulse bg-amber-400'
                )}
              />
            </Avatar>
            <div>
              <p className="font-semibold">{botId}</p>
              <p className="flex items-center gap-1 text-xs text-gray-400">
                <Activity className="size-3" />
                {headerSubtitle}
              </p>
            </div>
          </div>
          {!connecting && startedAt !== null && (
            <p
              className={cn(
                'pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full px-3 py-1 font-mono text-sm tabular-nums backdrop-blur-sm',
                isUserSharing
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-gray-800/60 text-gray-200'
              )}
            >
              {formatDuration(elapsed)}
              {isUserSharing ? (
                <span className="ml-1 font-sans">· {t('call.calling.sharing')}</span>
              ) : (
                isBotSharing && (
                  <span className="ml-1 font-sans">
                    · {t('call.calling.botSharing', { name: botId })}
                  </span>
                )
              )}
            </p>
          )}
          {userName && (
            <div className="flex items-center gap-3 text-right">
              <div>
                <p className="font-semibold">{userName}</p>
                <p className="text-xs text-gray-400">
                  {isUserSharing
                    ? t('call.calling.stopShare')
                    : connecting
                      ? t('call.waiting.title')
                      : t('call.statusOnline')}
                </p>
              </div>
              <Avatar size="lg" className="border border-gray-700/50 bg-gray-800/80 after:hidden">
                <AvatarFallback className="bg-transparent font-medium text-gray-500">
                  {userName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </div>
          )}
        </div>
      </header>

      {/* 主区：远端视频/分享、占位 */}
      <main className="flex flex-1 items-center justify-center px-4 pt-20 pb-40 md:pb-36">
        {/* 用户在分享：高亮自己的画面占位（本地预览不在此处显示） */}
        {isUserSharing && (
          <div className={`${SCREEN_FRAME_CLASS} border border-emerald-500/50`}>
            <div className="text-center">
              <Monitor className="mx-auto mb-3 size-14 text-emerald-400/50 md:mb-4 md:size-20" />
              <p className="text-lg font-medium text-gray-300 md:text-xl">
                {userName || t('call.statusOnline')}
              </p>
              <p className="mx-auto mt-3 flex max-w-xs items-center justify-center gap-1.5 text-balance px-3 text-xs text-amber-300/80 md:max-w-md md:text-sm">
                <ShieldAlert className="size-3.5 shrink-0 md:size-4" />
                <span>{t('call.calling.privacyNotice')}</span>
              </p>
            </div>
          </div>
        )}

        {/* Bot 在分享：渲染远端视频容器（id 必须等于 elementId） */}
        {!isUserSharing && isBotSharing && botRemoteSub && (
          <div className={`${SCREEN_FRAME_CLASS} border border-primary/30`}>
            <div id={botRemoteSub.elementId} className="h-full w-full" />
          </div>
        )}

        {/* 没有任何分享：脉冲占位 */}
        {!isUserSharing && !isBotSharing && (
          <div className="flex flex-col items-center justify-center px-4 text-center">
            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center justify-center">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="absolute animate-ping rounded-full border border-gray-700/50"
                    style={{
                      width: `${80 + i * 40}px`,
                      height: `${80 + i * 40}px`,
                      animationDelay: `${i * 0.8}s`,
                      animationDuration: '3s',
                      opacity: 0.3 - i * 0.1,
                    }}
                  />
                ))}
              </div>
              <Avatar
                size="xl"
                className="relative border border-gray-700/50 bg-gray-800/80 after:hidden"
              >
                <AvatarFallback className="bg-transparent text-gray-500">
                  <Bot className="size-10 md:size-12" />
                </AvatarFallback>
              </Avatar>
            </div>
            <p className="mb-2 text-lg font-medium text-gray-300 md:text-xl">{botId}</p>
            <div className="mb-4 flex items-center justify-center gap-2 text-gray-500">
              <Wifi className="size-4" />
              <p className="text-sm">
                {connecting ? t('call.waiting.title') : t('call.statusOnline')}
              </p>
            </div>
          </div>
        )}

        {/* 远端音频 (main) 容器：始终挂载（机器人无摄像头，但 SDK 仍需可挂载节点） */}
        <div className="sr-only">
          {remoteUsers
            .filter((u) => u.streamType !== 'sub')
            .map((u) => (
              <div key={u.elementId} id={u.elementId} />
            ))}
        </div>
      </main>

      {/* 控制栏 */}
      <div className="fixed inset-x-0 bottom-6 flex justify-center px-4 md:bottom-8">
        <div className="flex items-center gap-3 rounded-full border border-gray-700 bg-gray-800/90 px-4 py-3 shadow-2xl backdrop-blur-sm md:gap-4 md:px-6 md:py-4">
          <ControlButton
            onClick={onToggleAudio}
            tone={audioMuted ? 'warning' : 'neutral'}
            icon={audioMuted ? <MicOff /> : <Mic />}
            label={audioMuted ? t('call.calling.unmuteAudio') : t('call.calling.muteAudio')}
          />
          <ControlButton
            onClick={onToggleShare}
            disabled={shareBusy || connecting}
            tone={isUserSharing ? 'active' : 'neutral'}
            icon={isUserSharing ? <MonitorOff /> : <Monitor />}
            label={isUserSharing ? t('call.calling.stopShare') : t('call.calling.startShare')}
            labelClassName={isUserSharing ? 'text-emerald-400' : undefined}
          />
          <ControlButton
            onClick={onHangup}
            tone="destructive"
            icon={<PhoneOff />}
            label={t('call.calling.hangup')}
          />
        </div>
      </div>
    </div>
  );
}
