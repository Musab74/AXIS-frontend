import { useEffect, useState } from 'react';
import { Button, Card, pushToast } from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import { adminApi } from '@admin/services/api';

type Settings = {
  businessHoursStart: number;
  businessHoursEnd: number;
  defaultSlotCapacity: number;
  slotUnitMinutes: number;
};

export function OnDemandSettingsPanel() {
  const { t } = useI18n();
  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getOnDemandSettings()
      .then((res) => {
        if (!cancelled) setForm(res.data);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.response?.data?.message ?? t('sched.ondemand.loadError'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  };

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const res = await adminApi.updateOnDemandSettings(form);
      setForm(res.data);
      pushToast(t('sched.ondemand.saveSuccess'), 'green');
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string | string[] } } };
      const msg = ax?.response?.data?.message;
      const text = Array.isArray(msg) ? msg.join(', ') : msg || t('sched.ondemand.saveError');
      setError(text);
      pushToast(text, 'red');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4 mb-4 border-[var(--blue)]/20 bg-[var(--blue)]/[0.03]">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-[14px] font-semibold text-[var(--gray-800)]">
            {t('sched.ondemand.title')}
          </div>
          <p className="text-[12px] text-[var(--gray-500)] m-0 mt-0.5">
            {t('sched.ondemand.sub')}
          </p>
        </div>
        <Button variant="blue" size="sm" onClick={handleSave} disabled={saving || !form}>
          {saving ? t('sched.ondemand.saving') : t('sched.ondemand.save')}
        </Button>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          {error}
        </div>
      )}

      {!form ? (
        <div className="text-[13px] text-[var(--gray-400)]">{t('common.loading')}</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="block">
            <span className="block text-[12px] font-semibold text-[var(--gray-600)] mb-1.5">
              {t('sched.ondemand.hoursStart')}
            </span>
            <input
              className="axis-input axis-focus w-full"
              type="number"
              min={0}
              max={23}
              value={form.businessHoursStart}
              onChange={(e) => update('businessHoursStart', Number(e.target.value))}
            />
          </label>
          <label className="block">
            <span className="block text-[12px] font-semibold text-[var(--gray-600)] mb-1.5">
              {t('sched.ondemand.hoursEnd')}
            </span>
            <input
              className="axis-input axis-focus w-full"
              type="number"
              min={1}
              max={24}
              value={form.businessHoursEnd}
              onChange={(e) => update('businessHoursEnd', Number(e.target.value))}
            />
          </label>
          <label className="block">
            <span className="block text-[12px] font-semibold text-[var(--gray-600)] mb-1.5">
              {t('sched.ondemand.capacity')}
            </span>
            <input
              className="axis-input axis-focus w-full"
              type="number"
              min={1}
              max={99999}
              value={form.defaultSlotCapacity}
              onChange={(e) => update('defaultSlotCapacity', Number(e.target.value))}
            />
          </label>
          <label className="block">
            <span className="block text-[12px] font-semibold text-[var(--gray-600)] mb-1.5">
              {t('sched.ondemand.slotUnit')}
            </span>
            <select
              className="axis-input axis-focus w-full"
              value={form.slotUnitMinutes}
              onChange={(e) => update('slotUnitMinutes', Number(e.target.value))}
            >
              <option value={60}>60</option>
              <option value={30}>30</option>
            </select>
          </label>
        </div>
      )}
    </Card>
  );
}

export default OnDemandSettingsPanel;
