import { useEffect, useState } from 'react';
import { UserPlus, Loader2, ShieldCheck, KeyRound } from 'lucide-react';
import {
  Card,
  PageHeader,
  SectionHeader,
  Button,
  Input,
  CertTag,
  certCodeOf,
  TableWrap,
  Table,
  Th,
  Td,
  Modal,
  pushToast,
} from '@admin/components/shared/ui-kit';
import { MaskedPii } from '@admin/components/shared/MaskedPii';
import { adminApi, type CertType, type ExpertRow, type CreateExpertInput } from '@admin/services/api';
import { isSuperAdmin } from '@admin/utils/auth';
import { AxiosError } from 'axios';

const CERT_OPTIONS: { value: CertType; label: string; hint: string }[] = [
  { value: 'AXIS', label: 'AXIS', hint: '일반 업무' },
  { value: 'AXIS_C', label: 'AXIS-C', hint: '코딩·자동화' },
  { value: 'AXIS_H', label: 'AXIS-H', hint: '의료기관 비임상' },
];

const EMPTY_FORM: CreateExpertInput = {
  userId: '',
  password: '',
  name: '',
  phone: '',
  email: '',
  competencies: [],
};

export default function ExpertsPage() {
  const [experts, setExperts] = useState<ExpertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<CreateExpertInput>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [resetTarget, setResetTarget] = useState<ExpertRow | null>(null);
  const [resetting, setResetting] = useState(false);
  const [issuedTempPassword, setIssuedTempPassword] = useState<{
    name: string;
    userId: string;
    tempPassword: string;
  } | null>(null);
  const superAdmin = isSuperAdmin();

  const load = () => {
    setLoading(true);
    adminApi
      .getExperts()
      .then((res) => setExperts(res.data))
      .catch(() => pushToast('채점위원 목록을 불러오지 못했습니다', 'red'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const setField = <K extends keyof CreateExpertInput>(key: K, value: CreateExpertInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleCompetency = (ct: CertType) =>
    setForm((f) => ({
      ...f,
      competencies: f.competencies.includes(ct)
        ? f.competencies.filter((c) => c !== ct)
        : [...f.competencies, ct],
    }));

  const phoneDigits = form.phone.replace(/\D/g, '');
  const missingHint = (): string | null => {
    if (form.userId.trim().length < 4) return '아이디는 영문/숫자 4자 이상 입력하세요';
    if (form.password.length < 8) return '비밀번호는 8자 이상 입력하세요';
    if (form.name.trim().length < 1) return '이름을 입력하세요';
    if (phoneDigits.length < 9) return '연락처를 올바르게 입력하세요';
    if (form.competencies.length === 0) return '담당 분야를 1개 이상 선택하세요';
    return null;
  };

  const canSubmit = missingHint() === null && !submitting;

  const submit = async () => {
    const hint = missingHint();
    if (hint) {
      pushToast(hint, 'orange');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload: CreateExpertInput = {
        userId: form.userId.trim(),
        password: form.password,
        name: form.name.trim(),
        // Backend DTO allows digits/hyphens only — normalize before POST
        phone: phoneDigits,
        email: form.email?.trim() ? form.email.trim() : undefined,
        competencies: form.competencies,
      };
      const res = await adminApi.createExpert(payload);
      pushToast(`채점위원 "${res.data.name}" 계정이 생성되었습니다`, 'green');
      setForm(EMPTY_FORM);
      setExperts((prev) => [res.data, ...prev]);
    } catch (err) {
      const msg =
        (err as AxiosError<{ message?: string | string[] }>)?.response?.data?.message;
      pushToast(
        Array.isArray(msg) ? msg.join(', ') : msg || '계정 생성에 실패했습니다',
        'red',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const confirmReset = async () => {
    if (!resetTarget || resetting) return;
    setResetting(true);
    try {
      const res = await adminApi.resetUserPassword(resetTarget.id);
      setIssuedTempPassword({
        name: resetTarget.name,
        userId: resetTarget.userId,
        tempPassword: res.data.tempPassword,
      });
      setResetTarget(null);
      pushToast(`"${resetTarget.name}" 비밀번호가 초기화되었습니다`, 'green');
    } catch (err) {
      const msg =
        (err as AxiosError<{ message?: string | string[] }>)?.response?.data?.message;
      pushToast(
        Array.isArray(msg) ? msg.join(', ') : msg || '비밀번호 초기화에 실패했습니다',
        'red',
      );
    } finally {
      setResetting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="채점위원 관리"
        subtitle="채점위원(EXPERT) 계정을 생성하고 담당 분야를 지정합니다. 코딩 전문가는 코딩 과제만, 의료 전문가는 의료 과제만 채점 큐에서 보게 됩니다."
      />

      {/* ── Create form ── */}
      <Card className="mb-6 p-5">
        <SectionHeader
          title={
            <span className="inline-flex items-center gap-2">
              <UserPlus className="h-4 w-4" /> 채점위원 계정 생성
            </span>
          }
          subtitle="아이디·비밀번호·정보를 직접 지정합니다 (본인인증 불필요)."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="아이디 *">
            <Input
              value={form.userId}
              onChange={(e) => setField('userId', e.target.value)}
              placeholder="영문/숫자 4~30자"
              autoComplete="off"
            />
          </Field>
          <Field label="비밀번호 *">
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setField('password', e.target.value)}
              placeholder="8자 이상"
              autoComplete="new-password"
            />
          </Field>
          <Field label="이름 *">
            <Input value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="홍길동" />
          </Field>
          <Field label="연락처 *">
            <Input
              value={form.phone}
              onChange={(e) => setField('phone', e.target.value)}
              placeholder="01012345678"
            />
          </Field>
          <Field label="이메일">
            <Input
              type="email"
              value={form.email ?? ''}
              onChange={(e) => setField('email', e.target.value)}
              placeholder="(선택)"
            />
          </Field>
        </div>

        <div className="mt-5">
          <div className="text-[13px] font-semibold text-[var(--gray-600)] mb-2">담당 분야 * (복수 선택 가능)</div>
          <div className="flex flex-wrap gap-2.5">
            {CERT_OPTIONS.map((opt) => {
              const active = form.competencies.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleCompetency(opt.value)}
                  className={[
                    'axis-focus flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition-colors',
                    active
                      ? 'border-[var(--blue)] bg-[var(--blue-50)] text-[var(--gray-900)]'
                      : 'border-[var(--gray-border)] bg-white text-[var(--gray-600)] hover:bg-[var(--gray-50)]',
                  ].join(' ')}
                >
                  <CertTag code={certCodeOf(opt.value)} />
                  <span className="text-[var(--gray-500)]">{opt.hint}</span>
                  {active && <ShieldCheck className="h-3.5 w-3.5 text-[var(--blue)]" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <Button type="button" onClick={() => void submit()} disabled={!canSubmit} title={missingHint() ?? undefined}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            계정 생성
          </Button>
        </div>
      </Card>

      {/* ── Existing experts ── */}
      <Card className="p-5">
        <SectionHeader title="채점위원 목록" subtitle={`총 ${experts.length}명`} />
        {loading ? (
          <div className="flex items-center justify-center py-12 text-[var(--gray-500)]">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : experts.length === 0 ? (
          <div className="py-12 text-center text-[var(--gray-500)] text-[14px]">
            등록된 채점위원이 없습니다.
          </div>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th align="left">아이디</Th>
                  <Th align="left">이름</Th>
                  <Th align="left">연락처</Th>
                  <Th>담당 분야</Th>
                  <Th>상태</Th>
                  <Th>최근 로그인</Th>
                  {superAdmin && <Th>관리</Th>}
                </tr>
              </thead>
              <tbody>
                {experts.map((e) => (
                  <tr key={e.id}>
                    <Td align="left" mono>{e.userId}</Td>
                    <Td align="left" strong>{e.name}</Td>
                    <Td align="left">
                      <MaskedPii userDbId={e.id} field="phone" value={e.phone} />
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1 justify-center">
                        {e.competencies.length === 0 ? (
                          <span className="text-[var(--gray-400)]">미지정</span>
                        ) : (
                          e.competencies.map((c) => <CertTag key={c} code={certCodeOf(c)} />)
                        )}
                      </div>
                    </Td>
                    <Td muted>{e.accountStatus}</Td>
                    <Td muted>{e.lastLoginAt ? new Date(e.lastLoginAt).toLocaleDateString() : '—'}</Td>
                    {superAdmin && (
                      <Td>
                        <Button size="sm" variant="secondary" onClick={() => setResetTarget(e)}>
                          <KeyRound className="h-3.5 w-3.5 mr-1" />
                          비밀번호 초기화
                        </Button>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {/* ── Reset password confirm ── */}
      <Modal
        open={!!resetTarget}
        onClose={() => !resetting && setResetTarget(null)}
        title="비밀번호 초기화"
        width={440}
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetTarget(null)} disabled={resetting}>
              취소
            </Button>
            <Button variant="danger" onClick={confirmReset} disabled={resetting}>
              {resetting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              초기화
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-[var(--gray-700)]">
          <b>{resetTarget?.name}</b>({resetTarget?.userId}) 계정의 비밀번호를 일회용 임시 비밀번호로
          초기화합니다. 초기화 후 임시 비밀번호가 한 번 표시됩니다.
        </p>
        <ul className="mt-3 list-disc pl-5 text-[13px] text-[var(--gray-600)] space-y-1">
          <li>기존 로그인 세션은 즉시 종료됩니다.</li>
          <li>해당 채점위원은 임시 비밀번호로 로그인한 뒤 반드시 새 비밀번호로 변경해야 합니다.</li>
          <li>이 작업은 감사 로그에 기록됩니다.</li>
        </ul>
      </Modal>

      <Modal
        open={!!issuedTempPassword}
        onClose={() => setIssuedTempPassword(null)}
        title="임시 비밀번호 발급됨"
        width={440}
        footer={
          <Button variant="primary" onClick={() => setIssuedTempPassword(null)}>
            확인
          </Button>
        }
      >
        <p className="text-[14px] text-[var(--gray-700)]">
          <b>{issuedTempPassword?.name}</b>({issuedTempPassword?.userId}) 계정에 사용할 임시
          비밀번호입니다. 안전한 채널로 전달한 뒤 이 화면을 닫으세요.
        </p>
        <p className="mt-4 rounded-lg bg-[var(--gray-100)] px-3 py-3 font-mono text-[16px] tracking-wide text-center select-all">
          {issuedTempPassword?.tempPassword}
        </p>
        <p className="mt-3 text-[12px] text-[var(--gray-500)]">
          다음 로그인 시 비밀번호 변경이 강제됩니다. 이 비밀번호는 다시 조회할 수 없습니다.
        </p>
      </Modal>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-[var(--gray-600)]">{label}</span>
      {children}
    </label>
  );
}
