import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

export type CertType = 'AXIS' | 'AXIS_C' | 'AXIS_H';
export type CertLevel = 'L3' | 'L2' | 'L1';

export interface ScheduleSummary {
  id: string;
  certType: CertType;
  level: CertLevel;
  roundNumber: number;
  year: number;
  examDate: string;
  examStartTime: string;
  venue: string;
  capacity: number;
  remainingSeats: number;
  registrationEnd: string;
}

export type WizardStep = 1 | 2 | 3 | 4 | 5;

export interface WizardState {
  step: WizardStep;
  agreedToPrecheck: boolean;
  selectedCert: CertType | null;
  selectedLevel: CertLevel | null;
  selectedSchedule: ScheduleSummary | null;
  regId: string | null;
  seatHeldUntil: string | null;
  docUrl: string | null;
  consents: [boolean, boolean, boolean];
}

interface WizardActions {
  setAgreedToPrecheck: (v: boolean) => void;
  setCert: (cert: CertType | null) => void;
  setLevel: (level: CertLevel | null) => void;
  setSchedule: (s: ScheduleSummary) => void;
  setRegistration: (regId: string, seatHeldUntil: string | null) => void;
  /** Atomically save schedule + registration and advance one wizard step. */
  completeSessionStep: (schedule: ScheduleSummary, regId: string, seatHeldUntil: string) => void;
  setDocUrl: (url: string) => void;
  setConsent: (index: 0 | 1 | 2, value: boolean) => void;
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: WizardStep) => void;
  reset: () => void;
}

const defaultState: WizardState = {
  step: 1,
  agreedToPrecheck: false,
  selectedCert: null,
  selectedLevel: null,
  selectedSchedule: null,
  regId: null,
  seatHeldUntil: null,
  docUrl: null,
  consents: [false, false, false],
};

const WizardContext = createContext<(WizardState & WizardActions) | null>(null);

export function WizardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WizardState>(defaultState);

  const update = (partial: Partial<WizardState>) =>
    setState((s) => ({ ...s, ...partial }));

  const actions: WizardActions = {
    setAgreedToPrecheck: (v) => update({ agreedToPrecheck: v }),
    setCert: (cert) => update({ selectedCert: cert, selectedLevel: null, selectedSchedule: null }),
    setLevel: (level) => update({ selectedLevel: level, selectedSchedule: null }),
    setSchedule: (s) => update({ selectedSchedule: s }),
    setRegistration: (regId, seatHeldUntil) => update({ regId, seatHeldUntil: seatHeldUntil ?? null }),
    completeSessionStep: (schedule, regId, seatHeldUntil) =>
      setState((s) => ({
        ...s,
        selectedSchedule: schedule,
        regId,
        seatHeldUntil,
        step: Math.min(5, s.step + 1) as WizardStep,
      })),
    setDocUrl: (url) => update({ docUrl: url }),
    setConsent: (index, value) => {
      const consents: [boolean, boolean, boolean] = [...state.consents] as [boolean, boolean, boolean];
      consents[index] = value;
      update({ consents });
    },
    nextStep: () =>
      setState((s) => ({ ...s, step: Math.min(5, s.step + 1) as WizardStep })),
    prevStep: () =>
      setState((s) => ({ ...s, step: Math.max(1, s.step - 1) as WizardStep })),
    goToStep: (step) => update({ step }),
    reset: () => setState(defaultState),
  };

  return (
    <WizardContext.Provider value={{ ...state, ...actions }}>
      {children}
    </WizardContext.Provider>
  );
}

export function useWizard() {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizard must be used inside WizardProvider');
  return ctx;
}
