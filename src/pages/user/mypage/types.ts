export type SectionKey =
  | 'registrations'
  | 'schedule'
  | 'taken'
  | 'scores'
  | 'partial'
  | 'certs'
  | 'alerts'
  | 'profile';

export interface Profile {
  id: string;
  userId: string;
  name: string;
  phone?: string;
  email?: string | null;
  birthDate?: string | null;
  roles?: string[];
}

export type CertType = 'AXIS' | 'AXIS_C' | 'AXIS_H';
export type CertLevel = 'L3' | 'L2' | 'L1';

export type RegistrationStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'EXAM_COMPLETED';

export type EligibilityStatus = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface RegistrationDto {
  id: string;
  certType: CertType;
  level: CertLevel;
  status: RegistrationStatus;
  registrationNumber: string | null;
  partialExempt: boolean;
  cancelledAt: string | null;
  createdAt: string;
  seatHeldUntil: string | null;
  examDeadline: string | null;
  examDeadlineExpired: boolean;
  eligibilityStatus?: EligibilityStatus;
  eligibilityNote?: string | null;
  /** True when an L1 support document was uploaded (AXIS-C L1). */
  hasSupportDoc?: boolean;
  /** True when a 100% eligibility refund is awaiting admin approval. */
  eligibilityRefundRequested?: boolean;
  /** True when a candidate refund request (with bank account) is awaiting admin confirmation. */
  refundRequested?: boolean;
  refundRequestStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  fee: number | null;
  attemptUsed: number;
  maxAttempts: number;
  attemptsExhausted: boolean;
  schedule: {
    id: string;
    roundNumber: number;
    year: number;
    examDate: string;
    examStartTime: string;
    registrationEnd?: string;
    venue: string;
    status: string;
  };
  latestPayment: {
    id: string;
    orderId: string;
    amount: number;
    method: string | null;
    status: string;
    approvedAt: string | null;
    refundAmount: number | null;
    isDemo?: boolean;
  } | null;
}

export interface ResultDto {
  id: string;
  certType: CertType;
  level: CertLevel;
  attemptNo: number;
  status: 'SUBMITTED' | 'GRADED' | string;
  registrationId: string | null;
  registrationNumber: string | null;
  roundNumber: number | null;
  scheduleYear: number | null;
  submittedAt: string | null;
  startedAt: string | null;
  gradedAt: string | null;
  announced?: boolean;
  announcedAt: string | null;
  writtenScore: number | null;
  practicalScore: number | null;
  totalScore: number | null;
  passed: boolean | null;
  failReason: string | null;
  partialPass: 'WRITTEN_ONLY' | 'PRACTICAL_ONLY' | null;
  breakdown: {
    part: 'WRITTEN' | 'PRACTICAL' | 'DELIVERABLE' | 'ESSAY';
    subjectIndex: number;
    subjectName: string;
    earned: number;
    total: number;
    percentage: number;
    subjectFailed: boolean;
  }[];
}

export interface PartialDto {
  sessionId: string;
  certType: CertType;
  level: CertLevel;
  partType: 'WRITTEN_ONLY' | 'PRACTICAL_ONLY';
  writtenScore: number | null;
  practicalScore: number | null;
  submittedAt: string;
  expiresAt: string;
  active: boolean;
}

export interface CertificateDto {
  sessionId: string;
  certNumber: string;
  certType: CertType;
  level: CertLevel;
  issuedAt: string;
  validUntil: string;
  totalScore: number | null;
  holderName?: string;
  holderBirthDate?: string | null;
}

export interface UpcomingScheduleDto {
  id: string;
  certType: CertType;
  level: CertLevel;
  roundNumber: number;
  year: number;
  registrationStart: string;
  registrationEnd: string;
  examDate: string;
  examStartTime: string;
  capacity: number;
  currentCount: number;
  status: string;
}

export interface DashboardDto {
  profile: Profile;
  registrations: RegistrationDto[];
  registrationStats: {
    total: number;
    awaitingPayment: number;
    confirmed: number;
    cancelled: number;
  };
  results: ResultDto[];
  takenStats: { total: number; passed: number; partial: number; failed: number };
  partialExemptions: PartialDto[];
  certificates: CertificateDto[];
  upcomingSchedules: UpcomingScheduleDto[];
}

export type TabKey = 'registrations' | 'myExams' | 'scores' | 'certs' | 'inquiry' | 'profile';

export const TAB_CONFIG: { key: TabKey; labelKo: string; labelEn: string }[] = [
  { key: 'registrations', labelKo: '접수내역', labelEn: 'Registrations' },
  { key: 'myExams', labelKo: '나의시험', labelEn: 'My Exams' },
  { key: 'scores', labelKo: '성적조회', labelEn: 'Scores' },
  { key: 'certs', labelKo: '자격증', labelEn: 'Certificates' },
  { key: 'inquiry', labelKo: '문의하기', labelEn: 'Inquiries' },
  { key: 'profile', labelKo: '회원정보', labelEn: 'Profile' },
];

export const VALID_SECTIONS: SectionKey[] = [
  'registrations', 'schedule', 'taken', 'scores', 'partial', 'certs', 'alerts', 'profile',
];

export type BadgeTone = 'green' | 'orange' | 'red' | 'blue' | 'gray' | 'purple';

export type ExamEntryGateKind =
  | 'enter'
  | 'too_early'
  | 'too_late'
  | 'payment'
  | 'exhausted'
  | 'deadline'
  | 'eligibility_pending'
  | 'eligibility_rejected'
  | 'eligibility_missing_doc';
