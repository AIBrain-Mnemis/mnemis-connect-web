import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { ArrowLeft, RotateCw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { AmbientBackground } from '@/components/ui/ambient-background';
import { GlassCard } from '@/components/ui/glass-card';
import { BrandMark } from '@/components/ui/brand-mark';
import { StatusDot, type statusDotVariants } from '@/components/ui/status-dot';
import type { VariantProps } from 'class-variance-authority';
import { useCallSession } from '@/hooks/useCallSession';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import CallView from './CallView';

const BOT_ID_PATTERN = /^bot_[a-zA-Z0-9_]{1,32}$/;

type SetupBotStatus = 'idle' | 'busy' | 'offline' | 'error' | 'loading';
type StatusTone = NonNullable<VariantProps<typeof statusDotVariants>['tone']>;

const userNameKey = (botId: string) => `rtc:userName:${botId}`;

export default function CallPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { botId = '' } = useParams<{ botId: string }>();

  // 路径上 botId 非法 → 立即弹回首页
  useEffect(() => {
    if (!BOT_ID_PATTERN.test(botId)) {
      navigate('/', { replace: true });
    }
  }, [botId, navigate]);

  useDocumentTitle(BOT_ID_PATTERN.test(botId) ? t('call.pageTitle', { botId }) : null);

  const session = useCallSession(botId);
  const { state, trtc } = session;

  // 状态切换 toast：busy 仅在 connect 失败时弹出；查询状态接口返回 BUSY 不弹（顶部状态点已经反映）
  useEffect(() => {
    if (state.kind === 'busy' && state.from === 'connect') toast(t('call.toast.busy'));
    if (state.kind === 'offline' && state.reason === 'not_found') toast(t('call.toast.notFound'));
    if (state.kind === 'offline' && state.reason === 'expired') toast(t('call.toast.offline'));
  }, [state, t]);

  // 标签页切回前台时主动刷新（仅被动状态下，避免打断进行中的呼叫/通话）
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState !== 'visible') return;
      const k = state.kind;
      if (k === 'online' || k === 'busy' || k === 'offline' || k === 'error') {
        void session.refreshStatus();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [state.kind, session]);

  // 网络断/连提示
  useEffect(() => {
    const onOffline = () => toast.error(t('call.toast.networkError'));
    window.addEventListener('offline', onOffline);
    return () => window.removeEventListener('offline', onOffline);
  }, [t]);

  // 进入通话视图：waiting（已 reservation）和 calling 都展示全屏通话 UI
  if (state.kind === 'waiting' || state.kind === 'calling') {
    return (
      <CallView
        botId={botId}
        userName={readPersistedUserName(botId) ?? ''}
        connecting={state.kind === 'waiting'}
        startedAt={state.kind === 'calling' ? state.startedAt : null}
        deadline={state.kind === 'waiting' ? state.deadline : null}
        audioMuted={trtc.audioMuted}
        shareStatus={trtc.shareStatus}
        remoteUserPresent={trtc.remoteUserPresent}
        onToggleAudio={trtc.toggleAudioMute}
        onToggleShare={() => {
          if (trtc.shareStatus === 'started') void trtc.stopScreenShare();
          else if (trtc.shareStatus === 'idle') void trtc.startScreenShare();
        }}
        onHangup={() => {
          if (state.kind === 'waiting') void session.cancelWaiting();
          else void session.hangup();
        }}
      />
    );
  }

  // 其它所有状态：使用 Setup 视图（输入昵称 + 状态展示）
  let setupStatus: SetupBotStatus = 'loading';
  if (state.kind === 'online' || state.kind === 'modalOpen' || state.kind === 'reserving') {
    setupStatus = 'idle';
  } else if (state.kind === 'busy' || state.kind === 'timeout') {
    setupStatus = 'busy';
  } else if (state.kind === 'offline') {
    setupStatus = 'offline';
  } else if (state.kind === 'error') {
    setupStatus = 'error';
  } else if (state.kind === 'ended') {
    setupStatus = 'loading';
  }

  return (
    <SetupView
      botUsername={botId}
      botStatus={setupStatus}
      submitting={state.kind === 'reserving'}
      defaultUserName={readPersistedUserName(botId)}
      errorMessage={state.kind === 'error' ? state.message : undefined}
      onCall={(name) => session.startCall(name)}
      onRetry={() => session.retry()}
      onBack={() => navigate('/')}
    />
  );
}

function readPersistedUserName(botId: string): string | undefined {
  try {
    return sessionStorage.getItem(userNameKey(botId)) ?? undefined;
  } catch {
    return undefined;
  }
}

interface SetupViewProps {
  botUsername: string;
  botStatus: SetupBotStatus;
  submitting: boolean;
  defaultUserName?: string;
  errorMessage?: string;
  onCall: (userName: string) => void;
  onRetry: () => void;
  onBack: () => void;
}

const STATUS_TONE: Record<SetupBotStatus, StatusTone> = {
  idle: 'online',
  busy: 'busy',
  offline: 'offline',
  error: 'error',
  loading: 'loading',
};

function SetupView({
  botUsername,
  botStatus,
  submitting,
  defaultUserName,
  errorMessage,
  onCall,
  onRetry,
  onBack,
}: SetupViewProps) {
  const { t } = useTranslation();
  const [userName, setUserName] = useState(defaultUserName ?? '');
  const [micPermission, setMicPermission] = useState<'granted' | 'denied' | 'prompt' | 'checking'>(
    'checking'
  );

  useEffect(() => {
    if (defaultUserName && !userName) setUserName(defaultUserName);
  }, [defaultUserName, userName]);

  useEffect(() => {
    let cancelled = false;
    async function checkMic() {
      try {
        const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (cancelled) return;
        setMicPermission(result.state);
        result.addEventListener('change', () => {
          if (!cancelled) setMicPermission(result.state);
        });
      } catch {
        if (cancelled) return;
        setMicPermission('prompt');
      }
    }
    checkMic();
    return () => {
      cancelled = true;
    };
  }, []);

  const statusLabel: Record<SetupBotStatus, string> = {
    idle: t('call.statusOnline'),
    busy: t('call.statusBusy'),
    offline: t('call.statusOffline'),
    error: t('call.statusError'),
    loading: t('call.loading'),
  };

  const trimmed = userName.trim();
  const micDenied = micPermission === 'denied';
  // busy 状态也允许点击：connect 可能因同名重连返回房间凭据；只有真正占用才回退到 busy 提示
  const canCall =
    (botStatus === 'idle' || botStatus === 'busy') &&
    !submitting &&
    !micDenied &&
    trimmed.length > 0 &&
    trimmed.length <= 32;

  const handleCall = () => {
    if (!canCall) return;
    onCall(trimmed);
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden animate-in fade-in duration-300">
      <AmbientBackground />

      <header className="sticky top-0 z-10 border-b border-white/50 bg-white/40 backdrop-blur-xl">
        <div className="container mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={onBack}
            className="shrink-0 hover:bg-white/50"
            aria-label={t('call.back')}
          >
            <ArrowLeft />
          </Button>
          <BrandMark size="sm" />
          <div>
            <h1 className="font-semibold text-gray-800">{botUsername}</h1>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <StatusDot tone={STATUS_TONE[botStatus]} pulse={botStatus === 'idle'} />
              <span>{statusLabel[botStatus]}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center p-4">
        <GlassCard className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h2 className="text-balance text-xl font-semibold text-gray-800">
            {t('call.modal.title')}
          </h2>

          <div className="mt-6 space-y-5">
            <Field>
              <FieldLabel htmlFor="userName" className="sr-only">
                {t('call.modal.placeholder')}
              </FieldLabel>
              <Input
                id="userName"
                type="text"
                size="lg"
                placeholder={t('call.modal.placeholder')}
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCall();
                }}
                maxLength={32}
                disabled={submitting}
                autoComplete="off"
              />
            </Field>

            {botStatus === 'error' && errorMessage && (
              <p className="text-sm text-destructive">{errorMessage}</p>
            )}

            {micDenied && <p className="text-sm text-destructive">{t('call.micDenied')}</p>}

            {botStatus === 'idle' || botStatus === 'loading' || botStatus === 'busy' ? (
              <Button
                onClick={handleCall}
                size="xl"
                className="w-full font-medium"
                disabled={!canCall}
              >
                {submitting ? (
                  <>
                    <Spinner className="size-5" />
                    {t('call.loading')}
                  </>
                ) : (
                  t('call.callBtn')
                )}
              </Button>
            ) : (
              <Button onClick={onRetry} size="xl" variant="outline" className="w-full font-medium">
                <RotateCw />
                {t('call.retry')}
              </Button>
            )}
          </div>
        </GlassCard>
      </main>
    </div>
  );
}
