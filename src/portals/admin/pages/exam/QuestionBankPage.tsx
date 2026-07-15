import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useI18n } from '@admin/i18n';
import {
  adminApi,
  QuestionRow,
  QuestionUploadResult,
  TaskRow,
  QuestionStats,
  TaskStats,
  SubjectRow,
  CertType,
  CertLevel,
  Pagination as ApiPagination,
} from '@admin/services/api';
import {
  FileText,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  RefreshCw,
  AlertCircle,
  Upload,
  Download,
  Info,
} from 'lucide-react';
import {
  PageHeader,
  SimpleKpiCard,
  Button,
  Card,
  FilterBar,
  Select,
  Search,
  Tabs,
  TabItem,
  Pagination,
} from '@admin/components/shared/ui-kit';

type TabType = 'mcq' | 'tasks';

const CERT_TYPES: CertType[] = ['AXIS', 'AXIS_C', 'AXIS_H'];
const CERT_LEVELS: CertLevel[] = ['L1', 'L2', 'L3'];

const CERT_LABELS: Record<CertType, string> = {
  AXIS: 'AXIS',
  AXIS_C: 'AXIS-C (Coding)',
  AXIS_H: 'AXIS-H (Healthcare)',
};

const LEVEL_LABELS: Record<CertLevel, string> = {
  L3: 'Level 3 (입문)',
  L2: 'Level 2 (중급)',
  L1: 'Level 1 (전문)',
};

const TAB_ITEMS: TabItem<TabType>[] = [
  { id: 'mcq', label: '객관식 문항 (MCQ)' },
  { id: 'tasks', label: '실기 과제 (Tasks)' },
];

function formatCertLabel(certType: CertType): string {
  return certType === 'AXIS_C' ? 'AXIS-C' : certType === 'AXIS_H' ? 'AXIS-H' : 'AXIS';
}

export default function QuestionBankPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabType>('mcq');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stats
  const [questionStats, setQuestionStats] = useState<QuestionStats | null>(null);
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);

  // Filters
  const [certType, setCertType] = useState<CertType | ''>('');
  const [level, setLevel] = useState<CertLevel | ''>('');
  /** Composite key certType|level|subjectIndex — avoids index collisions across levels. */
  const [subjectKey, setSubjectKey] = useState('');
  const [searchInput, setSearchInput] = useState('');
  /** Committed search query used for API fetches (Search button / Enter). */
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(1);

  // Data
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [pagination, setPagination] = useState<ApiPagination | null>(null);

  const subjectIndex = useMemo(() => {
    if (!subjectKey) return '' as const;
    const parts = subjectKey.split('|');
    const idx = Number.parseInt(parts[2] ?? '', 10);
    return Number.isFinite(idx) ? idx : ('' as const);
  }, [subjectKey]);

  // Expanded rows
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Upload modal
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<QuestionUploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter subjects based on certType and level
  const filteredSubjects = useMemo(() => {
    return subjects.filter((s) => {
      if (certType && s.certType !== certType) return false;
      if (level && s.level !== level) return false;
      return true;
    });
  }, [subjects, certType, level]);

  // Load initial stats
  useEffect(() => {
    const loadStats = async () => {
      try {
        const [qStats, tStats, subjs] = await Promise.all([
          adminApi.getQuestionStats(),
          adminApi.getTaskStats(),
          adminApi.getSubjects(),
        ]);
        setQuestionStats(qStats.data);
        setTaskStats(tStats.data);
        setSubjects(subjs.data);
      } catch (err) {
        setError('Failed to load question bank stats');
      }
    };
    loadStats();
  }, []);

  // Load questions or tasks
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === 'mcq') {
        const res = await adminApi.getQuestions({
          certType: certType || undefined,
          level: level || undefined,
          subjectIndex: subjectIndex !== '' ? subjectIndex : undefined,
          search: appliedSearch || undefined,
          page,
          limit: 15,
        });
        setQuestions(res.data.questions);
        setTasks([]);
        setPagination(res.data.pagination);
      } else {
        const res = await adminApi.getTasks({
          certType: certType || undefined,
          level: level || undefined,
          search: appliedSearch || undefined,
          page,
          limit: 15,
        });
        setTasks(res.data.tasks);
        setQuestions([]);
        setPagination(res.data.pagination);
      }
    } catch (err) {
      setError('Failed to load data');
      setQuestions([]);
      setTasks([]);
      setPagination(null);
    } finally {
      setLoading(false);
    }
  }, [tab, certType, level, subjectIndex, appliedSearch, page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reset filters when tab changes
  const handleTabChange = (newTab: TabType) => {
    if (newTab === tab) return;
    setLoading(true);
    setPagination(null);
    setQuestions([]);
    setTasks([]);
    setError(null);
    setTab(newTab);
    setPage(1);
    setExpandedId(null);
    setCertType('');
    setLevel('');
    setSubjectKey('');
    setSearchInput('');
    setAppliedSearch('');
  };

  const handleSearch = () => {
    const next = searchInput.trim();
    setPage(1);
    setAppliedSearch(next);
    // If appliedSearch is unchanged, loadData won't re-run — force refresh.
    if (next === appliedSearch && page === 1) {
      void loadData();
    }
  };

  const handleClearFilters = () => {
    setCertType('');
    setLevel('');
    setSubjectKey('');
    setSearchInput('');
    setAppliedSearch('');
    setPage(1);
  };

  const openUpload = () => {
    setUploadFile(null);
    setUploadResult(null);
    setUploadError(null);
    setUploadOpen(true);
  };

  const closeUpload = () => {
    setUploadOpen(false);
    setUploadFile(null);
    setUploadResult(null);
    setUploadError(null);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDownloadTemplate = async (kind: 'mcq' | 'task') => {
    try {
      const blob = await adminApi.downloadQuestionTemplate(kind);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = kind === 'task' ? 'AXIS_template_practical.csv' : 'AXIS_template_mcq.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setUploadError('템플릿 다운로드에 실패했습니다.');
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    setUploadError(null);
    setUploadResult(null);
    try {
      const res = await adminApi.uploadQuestionCsv(uploadFile);
      setUploadResult(res.data);
      // Refresh stats and current list so the new file shows up.
      try {
        const [qStats, tStats, subjs] = await Promise.all([
          adminApi.getQuestionStats(),
          adminApi.getTaskStats(),
          adminApi.getSubjects(),
        ]);
        setQuestionStats(qStats.data);
        setTaskStats(tStats.data);
        setSubjects(subjs.data);
      } catch {
        // non-fatal
      }
      await loadData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string | string[] } }; message?: string };
      const msg = e?.response?.data?.message;
      setUploadError(
        Array.isArray(msg) ? msg.join('; ') : msg || e?.message || '업로드 중 오류가 발생했습니다.',
      );
    } finally {
      setUploading(false);
    }
  };

  const renderQuestionContent = (q: QuestionRow) => {
    const choices = q.choices as { label: string; text: string }[] | null;
    return (
      <div className="bg-slate-50 p-4 rounded-lg space-y-4 text-sm">
        {/* Question stem */}
        <div>
          <label className="font-semibold text-slate-700 block mb-1">문제 (Stem)</label>
          <div className="bg-white p-3 rounded border whitespace-pre-wrap text-gray-700">{q.stem}</div>
        </div>

        {/* Choices */}
        {choices && choices.length > 0 && (
          <div>
            <label className="font-semibold text-slate-700 block mb-1">보기 (Choices)</label>
            <div className="bg-white rounded border divide-y">
              {choices.map((c) => (
                <div
                  key={c.label}
                  className={`p-3 flex items-start gap-3 ${
                    q.correctAnswer === c.label ? 'bg-green-50 border-l-4 border-green-500' : ''
                  }`}
                >
                  <span
                    className={`font-mono font-bold min-w-[24px] ${
                      q.correctAnswer === c.label ? 'text-green-700' : 'text-slate-500'
                    }`}
                  >
                    {c.label}.
                  </span>
                  <span className={q.correctAnswer === c.label ? 'text-green-800 font-medium' : 'text-slate-500'}>
                    {c.text}
                  </span>
                  {q.correctAnswer === c.label && (
                    <Check className="w-5 h-5 text-green-600 ml-auto flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Correct answer summary */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">정답:</span>
            <span className="px-2 py-1 bg-green-100 text-green-800 rounded font-mono font-bold">
              {q.correctAnswer ?? 'N/A'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">배점:</span>
            <span className="text-blue-700 font-medium">{q.points}점</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">버전:</span>
            <span className="text-slate-600">v{q.qVersion}</span>
          </div>
        </div>

        {/* Meta info */}
        <div className="flex flex-wrap gap-4 text-xs text-slate-500 pt-2 border-t">
          <span>ID: {q.id.slice(0, 8)}...</span>
          <span>유형: {q.type}</span>
          <span>상태: {q.active ? '활성' : '비활성'}</span>
          <span>등록일: {new Date(q.createdAt).toLocaleDateString('ko-KR')}</span>
        </div>
      </div>
    );
  };

  const renderTaskContent = (task: TaskRow) => {
    const rubric = task.rubric as { criteria?: { name: string; points: number; description: string }[] } | null;
    return (
      <div className="bg-slate-50 p-4 rounded-lg space-y-4 text-sm">
        {/* Scenario */}
        <div>
          <label className="font-semibold text-slate-700 block mb-1">시나리오 (Scenario)</label>
          <div className="bg-white p-3 rounded border whitespace-pre-wrap text-gray-700">{task.scenario}</div>
        </div>

        {/* Rubric */}
        {rubric?.criteria && rubric.criteria.length > 0 && (
          <div>
            <label className="font-semibold text-slate-700 block mb-1">채점 기준 (Rubric)</label>
            <div className="bg-white rounded border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-700">기준</th>
                    <th className="px-3 py-2 text-left text-gray-700">배점</th>
                    <th className="px-3 py-2 text-left text-gray-700">설명</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rubric.criteria.map((c, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-medium text-gray-700">{c.name}</td>
                      <td className="px-3 py-2 text-blue-600">{c.points}점</td>
                      <td className="px-3 py-2 text-slate-600">{c.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Meta info */}
        <div className="flex flex-wrap gap-4 text-xs text-slate-500 pt-2 border-t">
          <span>ID: {task.id.slice(0, 8)}...</span>
          <span>제한시간: {task.durationMin}분</span>
          <span>총점: {task.points}점</span>
          <span>순서: {task.orderIndex}</span>
          <span>등록일: {new Date(task.createdAt).toLocaleDateString('ko-KR')}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('page.questions.title')}
        subtitle={t('page.questions.sub')}
        actions={
          <>
            <Button variant="secondary" onClick={loadData}>
              <RefreshCw className="w-3.5 h-3.5" /> {t('common.refresh')}
            </Button>
            <Button variant="blue" onClick={openUpload}>
              <Upload className="w-3.5 h-3.5" /> {t('qb.upload')}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <SimpleKpiCard
          label={t('qb.kpi.totalQuestions')}
          value={questionStats?.total.toLocaleString() ?? '—'}
          unit={t('unit.questions')}
          meta={<span className="text-[var(--gray-500)]">객관식 전체 문항 수</span>}
        />
        <SimpleKpiCard
          label={t('qb.kpi.totalTasks')}
          value={taskStats?.total.toLocaleString() ?? '—'}
          unit={t('unit.items')}
          meta={<span className="text-[var(--gray-500)]">실기 과제 전체 수</span>}
        />
        <SimpleKpiCard
          label={t('qb.kpi.axisAuthored')}
          value={
            questionStats?.byCertType.find((s) => s.certType === 'AXIS')?.count.toLocaleString() ?? '0'
          }
          unit={t('unit.questions')}
          meta={<span className="text-[var(--gray-500)]">AXIS 일반 문항 수</span>}
        />
        <SimpleKpiCard
          label={t('qb.kpi.subjects')}
          value={subjects.length}
          unit={t('unit.subjects')}
          meta={<span className="text-[var(--gray-500)]">등록된 과목 수</span>}
        />
      </div>

      <Tabs tabs={TAB_ITEMS} active={tab} onChange={handleTabChange} />

      <FilterBar className="justify-between gap-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={certType}
            onChange={(e) => {
              setCertType(e.target.value as CertType | '');
              setSubjectKey('');
              setPage(1);
            }}
          >
            <option value="">자격증 전체</option>
            {CERT_TYPES.map((ct) => (
              <option key={ct} value={ct}>{CERT_LABELS[ct]}</option>
            ))}
          </Select>

          <Select
            value={level}
            onChange={(e) => {
              setLevel(e.target.value as CertLevel | '');
              setSubjectKey('');
              setPage(1);
            }}
          >
            <option value="">급수 전체</option>
            {CERT_LEVELS.map((l) => (
              <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
            ))}
          </Select>

          {tab === 'mcq' && (
            <Select
              value={subjectKey}
              onChange={(e) => {
                const key = e.target.value;
                setSubjectKey(key);
                if (key) {
                  const [ct, lv] = key.split('|');
                  if (ct === 'AXIS' || ct === 'AXIS_C' || ct === 'AXIS_H') {
                    setCertType(ct);
                  }
                  if (lv === 'L1' || lv === 'L2' || lv === 'L3') {
                    setLevel(lv);
                  }
                }
                setPage(1);
              }}
            >
              <option value="">과목 전체</option>
              {filteredSubjects.map((s) => {
                const key = `${s.certType}|${s.level}|${s.subjectIndex}`;
                const prefix =
                  !certType || !level ? `${formatCertLabel(s.certType)} ${s.level} · ` : '';
                return (
                  <option key={key} value={key}>
                    {prefix}
                    {s.subjectName} ({s.questionCount})
                  </option>
                );
              })}
            </Select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Search
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder={tab === 'mcq' ? '문항 내용 검색' : '과제명 또는 시나리오 검색'}
            className="min-w-[260px]"
          />
          <Button variant="blue" onClick={handleSearch}>
            검색
          </Button>
          {(certType || level || subjectKey || appliedSearch || searchInput) && (
            <Button variant="secondary" onClick={handleClearFilters}>
              초기화
            </Button>
          )}
        </div>
      </FilterBar>

      {/* Error */}
      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg flex items-center gap-2">
          <X className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* Data table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
            <p>데이터 로딩 중...</p>
          </div>
        ) : tab === 'mcq' ? (
          questions.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>문항이 없습니다</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--gray-100)]">
              {questions.map((q) => (
                <div key={q.id} className="hover:bg-[var(--gray-50)]">
                  <div
                    onClick={() => setExpandedId(expandedId === q.id ? null : q.id)}
                    className="px-4 py-3.5 cursor-pointer"
                  >
                    <div className="flex items-start gap-5">
                      {/* Question meta */}
                      <div className="min-w-[84px] pt-0.5">
                        <div className="text-[14px] font-semibold text-[var(--gray-800)]">
                          {formatCertLabel(q.certType)}
                        </div>
                        <div className="mt-1 text-[12px] text-[var(--gray-500)]">
                          {q.level}
                        </div>
                      </div>

                      {/* Question preview */}
                      <div className="flex-1 min-w-0 pt-0.5">
                        <p className="line-clamp-2 text-[15px] font-medium leading-6 text-[var(--gray-900)]">
                          {q.stem}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--gray-500)]">
                          <span>{q.subjectName}</span>
                          <span className="text-[var(--gray-300)]">|</span>
                          <span>{q.type}</span>
                          <span className="text-[var(--gray-300)]">|</span>
                          <span>{q.points}점</span>
                        </div>
                      </div>

                      {/* Correct answer & expand */}
                      <div className="flex items-start gap-4 pl-2">
                        <div className="min-w-[42px] text-center">
                          <div className="mb-1 text-[11px] text-[var(--gray-500)]">정답</div>
                          <div className="text-[15px] font-semibold text-[var(--green)]">
                            {q.correctAnswer ?? '-'}
                          </div>
                        </div>
                        <button className="pt-3 text-[var(--gray-400)] hover:text-[var(--gray-600)]">
                          {expandedId === q.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Expanded content */}
                  {expandedId === q.id && (
                    <div className="px-4 pb-4">
                      {renderQuestionContent(q)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        ) : tasks.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <ClipboardList className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>실기 과제가 없습니다</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--gray-100)]">
            {tasks.map((task) => (
              <div key={task.id} className="hover:bg-[var(--gray-50)]">
                <div
                  onClick={() => setExpandedId(expandedId === task.id ? null : task.id)}
                  className="px-4 py-3.5 cursor-pointer"
                >
                  <div className="flex items-start gap-5">
                    {/* Task meta */}
                    <div className="min-w-[100px] pt-0.5">
                      <div className="text-[14px] font-semibold text-[var(--gray-800)]">{task.part}</div>
                      <div className="mt-1 text-[12px] text-[var(--gray-500)]">
                        {formatCertLabel(task.certType)} · {task.level}
                      </div>
                    </div>

                    {/* Task preview */}
                    <div className="flex-1 min-w-0 pt-0.5">
                      <p className="text-[15px] font-medium leading-6 text-[var(--gray-900)]">{task.title}</p>
                      <p className="mt-1 line-clamp-2 text-[15px] leading-5 text-[var(--gray-600)]">{task.scenario}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--gray-500)]">
                        <span>{task.durationMin}분</span>
                        <span className="text-[var(--gray-300)]">|</span>
                        <span>{task.points}점</span>
                        <span className="text-[var(--gray-300)]">|</span>
                        <span>순서 #{task.orderIndex}</span>
                      </div>
                    </div>

                    {/* Expand */}
                    <button className="pt-3 text-[var(--gray-400)] hover:text-[var(--gray-600)]">
                      {expandedId === task.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {/* Expanded content */}
                {expandedId === task.id && (
                  <div className="px-4 pb-4">
                    {renderTaskContent(task)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Upload modal */}
      {uploadOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-bold text-slate-800">문항 일괄 업로드 (CSV)</h2>
              </div>
              <button
                onClick={closeUpload}
                className="text-slate-400 hover:text-slate-700"
                aria-label="close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Production safety notice */}
              <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 text-sm flex gap-2">
                <Info className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-600" />
                <div>
                  <p className="font-semibold mb-1">운영 안전 안내</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>업로드된 CSV는 <b>문제은행 관리 화면에만</b> 즉시 반영됩니다.</li>
                    <li>실제 시험에 노출되려면 운영팀이 <code className="bg-amber-100 px-1 rounded">db:seed:questions</code> 작업을 별도 수행해야 합니다.</li>
                    <li>현재 진행 중인 시험에는 영향을 주지 않습니다 (DB 변경 없음).</li>
                  </ul>
                </div>
              </div>

              {/* Format spec */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-800">CSV 형식</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDownloadTemplate('mcq')}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100"
                    >
                      <Download className="w-4 h-4" />
                      객관식 템플릿
                    </button>
                    <button
                      onClick={() => handleDownloadTemplate('task')}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100"
                    >
                      <Download className="w-4 h-4" />
                      실기 템플릿
                    </button>
                  </div>
                </div>

                {/* MCQ format */}
                <div className="bg-slate-50 border rounded-lg p-3 text-xs">
                  <div className="font-semibold text-slate-700 mb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-600" />
                    객관식 문항 (MCQ) — 필수 컬럼
                  </div>
                  <div className="font-mono text-[11px] bg-white border rounded p-2 overflow-x-auto whitespace-nowrap">
                    no, cert_type, level, subject, domain_area, q_type, item_purpose, difficulty, content, option_a, option_b, option_c, option_d, correct_answer, points, explanation, source_ref, shuffle_exempt, review_status, review_comment, version, created_by, created_date
                  </div>
                  <ul className="mt-2 space-y-0.5 text-slate-600 list-disc list-inside">
                    <li><b>cert_type</b>: <code>AXIS</code> / <code>AXIS_C</code> / <code>AXIS_H</code></li>
                    <li><b>level</b>: <code>L1</code> / <code>L2</code> / <code>L3</code></li>
                    <li><b>correct_answer</b>: <code>A</code>/<code>B</code>/<code>C</code>/<code>D</code> (해당 보기 텍스트 필수)</li>
                    <li><b>option_a~d</b>: 최소 2개 이상 채워야 함</li>
                    <li><b>points</b>: 양의 정수 (보통 2)</li>
                  </ul>
                </div>

                {/* Practical format */}
                <div className="bg-slate-50 border rounded-lg p-3 text-xs">
                  <div className="font-semibold text-slate-700 mb-2 flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-emerald-600" />
                    실기 과제 (Practical) — 필수 컬럼
                  </div>
                  <div className="font-mono text-[11px] bg-white border rounded p-2 overflow-x-auto whitespace-nowrap">
                    set_no, cert_type, level, task_type, task_title, time_limit, scenario_content, sample_data, required_structure, forbidden_rules, ai_tool_allowed, rubric, max_score, model_answer, risk_criteria, benchmark_excellent, benchmark_normal, benchmark_borderline, benchmark_fail, ai_prompt_version, review_status, review_comment, version, created_by, created_date
                  </div>
                  <ul className="mt-2 space-y-0.5 text-slate-600 list-disc list-inside">
                    <li><b>task_type</b>: <code>part_a</code> / <code>part_b</code> 등</li>
                    <li><b>time_limit</b>: 분 단위 양의 정수</li>
                    <li><b>max_score</b>: 양의 정수 (예: 60)</li>
                    <li><b>rubric</b>: <code>"기준명(점수): 설명 | 기준명(점수): 설명"</code> 파이프(<code>|</code>) 구분</li>
                    <li><b>scenario_content</b> 필수 (비어있을 수 없음)</li>
                  </ul>
                </div>

                <p className="text-xs text-slate-500">
                  파일에 <code className="bg-slate-100 px-1 rounded">set_no</code> 컬럼이 있으면 실기 과제로,
                  없으면 객관식 문항으로 자동 인식됩니다. 파일명 예: <code>AXIS_L3_200.csv</code>,{' '}
                  <code>AXIS_L1_실기.csv</code>
                </p>
              </div>

              {/* File picker */}
              <div className="border-2 border-dashed rounded-lg p-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">CSV 파일 선택</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    setUploadFile(e.target.files?.[0] ?? null);
                    setUploadResult(null);
                    setUploadError(null);
                  }}
                  className="block w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:cursor-pointer hover:file:bg-blue-700"
                />
                {uploadFile && (
                  <p className="text-xs text-slate-600 mt-2">
                    선택됨: <b>{uploadFile.name}</b> ({(uploadFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>

              {/* Errors */}
              {uploadError && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm flex gap-2">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span className="break-words">{uploadError}</span>
                </div>
              )}

              {/* Success */}
              {uploadResult && (
                <div className="bg-green-50 border border-green-200 text-green-800 p-3 rounded-lg text-sm space-y-2">
                  <div className="flex items-center gap-2 font-semibold">
                    <Check className="w-5 h-5 text-green-600" />
                    업로드 성공: {uploadResult.fileName}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>유형: <b>{uploadResult.kind === 'task' ? '실기' : '객관식'}</b></div>
                    <div>총 행: <b>{uploadResult.rowsParsed}</b></div>
                    <div>유효 행: <b>{uploadResult.rowsValid}</b></div>
                  </div>
                  {uploadResult.warnings.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-amber-700 font-medium">
                        경고 {uploadResult.warnings.length}건
                      </summary>
                      <ul className="mt-1 ml-4 list-disc max-h-32 overflow-y-auto">
                        {uploadResult.warnings.slice(0, 50).map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {uploadResult.errors.length > 0 && (
                    <details className="text-xs" open>
                      <summary className="cursor-pointer text-red-700 font-medium">
                        오류 {uploadResult.errors.length}건 (해당 행은 무시됨)
                      </summary>
                      <ul className="mt-1 ml-4 list-disc max-h-32 overflow-y-auto">
                        {uploadResult.errors.slice(0, 50).map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t bg-slate-50 rounded-b-xl">
              <button
                onClick={closeUpload}
                className="px-4 py-2 text-slate-700 bg-white border rounded-lg hover:bg-slate-100"
              >
                {uploadResult ? '닫기' : '취소'}
              </button>
              <button
                onClick={handleUpload}
                disabled={!uploadFile || uploading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {uploading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    업로드 중...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    업로드
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pagination */}
      {pagination && (
        <Pagination
          page={page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          onChange={setPage}
        />
      )}
    </div>
  );
}
