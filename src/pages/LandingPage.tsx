import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { AmbientBackground } from '@/components/ui/ambient-background';
import { GlassCard } from '@/components/ui/glass-card';
import { BrandMark } from '@/components/ui/brand-mark';
import { TRTC } from '@/hooks/useTRTC';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

const SUFFIX_PATTERN = /^[a-zA-Z0-9]+$/;
const MAX_SUFFIX_LEN = 12;
const STORAGE_KEY = 'last_bot_id';

function stripPrefix(raw: string): string {
  return raw.replace(/^bot_/i, '');
}

function sanitizeSuffix(raw: string): string {
  return stripPrefix(raw)
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, MAX_SUFFIX_LEN);
}

export default function LandingPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [suffix, setSuffix] = useState('');
  const [touched, setTouched] = useState(false);
  const [overflow, setOverflow] = useState(false);

  useDocumentTitle(t('landing.pageTitle'));

  useEffect(() => {
    try {
      const last = localStorage.getItem(STORAGE_KEY);
      if (last) setSuffix(sanitizeSuffix(last));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    TRTC.isSupported()
      .then((r: { result: boolean }) => {
        if (!r.result) {
          const isZh = i18n.language.startsWith('zh');
          toast.error(
            isZh
              ? '当前浏览器不支持 RTC，请使用最新版 Edge'
              : 'Your browser does not support RTC. Please use the latest Edge.'
          );
        }
      })
      .catch(() => {
        /* ignore */
      });
  }, [i18n.language]);

  const valid = suffix.length > 0 && SUFFIX_PATTERN.test(suffix);
  // 超长优先于空：用户键入/粘贴超过 12 个有效字符时立即提示，无需等失焦。
  const errorMsg = overflow
    ? t('landing.errorTooLong')
    : touched && suffix.length === 0
      ? t('landing.errorEmpty')
      : '';
  const showError = errorMsg !== '';

  const handleChange = (raw: string) => {
    const cleanedLen = stripPrefix(raw).replace(/[^a-zA-Z0-9]/g, '').length;
    setOverflow(cleanedLen > MAX_SUFFIX_LEN);
    setSuffix(sanitizeSuffix(raw));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    const fullId = `bot_${suffix}`;
    try {
      localStorage.setItem(STORAGE_KEY, fullId);
    } catch {
      /* ignore */
    }
    navigate(`/bot/${fullId}`);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <AmbientBackground />

      <GlassCard className="relative z-10 w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="space-y-6 text-center">
          <BrandMark size="lg" className="mx-auto" />
          <h1 className="text-balance text-2xl font-semibold text-gray-800">
            {t('landing.brand')}
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <Field data-invalid={showError}>
            <FieldLabel htmlFor="input-bot-userid">{t('landing.fieldLabel')}</FieldLabel>
            <InputGroup className="h-12 rounded-xl">
              <InputGroupAddon>
                <InputGroupText className="text-base text-muted-foreground">bot_</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="input-bot-userid"
                value={suffix}
                onChange={(e) => handleChange(e.target.value)}
                onBlur={() => setTouched(true)}
                placeholder={t('landing.placeholder')}
                spellCheck={false}
                autoComplete="off"
                inputMode="text"
                maxLength={MAX_SUFFIX_LEN}
                aria-invalid={showError}
                className="text-base"
              />
            </InputGroup>
            <FieldDescription className={cn({ 'text-destructive': showError })}>
              {showError ? errorMsg : t('landing.hint')}
            </FieldDescription>
          </Field>
          <Button type="submit" size="xl" disabled={!valid} className="w-full">
            {t('landing.submit')}
          </Button>
        </form>
      </GlassCard>
    </div>
  );
}
