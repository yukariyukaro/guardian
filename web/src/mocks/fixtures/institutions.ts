import type { InstitutionDto, MetadataDto, SourceDto, TimelineDto } from '../../lib/api/public-api';

const mistRegion = {
  code: 'fictional-mist-region',
  name: '虚构雾省雾港市',
  province: '虚构雾省',
  city: '虚构雾港市',
};
const moonRegion = {
  code: 'fictional-moon-region',
  name: '虚构月省月湾市',
  province: '虚构月省',
  city: '虚构月湾市',
};

export const mockInstitutions: InstitutionDto[] = [
  {
    slug: 'fictional-mist-harbor-center',
    name: '虚构示例·雾港成长中心',
    aliases: ['虚构示例·雾港旧称'],
    region: mistRegion,
    operating_status: 'unknown',
    risk_tags: ['regulatory_action'],
    evidence_status: 'official_record',
    public_summary:
      '完全虚构的演示档案，用于呈现公开通告索引与人工复核日期，不对应任何真实机构或事实。',
    source_count: 1,
    last_reviewed_at: '2026-01-05T08:00:00Z',
    updated_at: '2026-01-05T08:00:00Z',
  },
  {
    slug: 'fictional-moon-bay-center',
    name: '虚构示例·月湾学习中心',
    aliases: ['虚构示例·月湾学苑'],
    region: moonRegion,
    operating_status: 'relocated',
    risk_tags: ['name_or_location_change'],
    evidence_status: 'multiple_sources',
    public_summary:
      '完全虚构的演示档案，用于展示名称及粗粒度地区变动。示例不陈述真实争议，也不包含个人资料。',
    source_count: 2,
    last_reviewed_at: '2026-01-04T08:00:00Z',
    updated_at: '2026-01-04T08:00:00Z',
  },
  {
    slug: 'fictional-paper-river-center',
    name: '虚构示例·纸河研习中心',
    aliases: [],
    region: mistRegion,
    operating_status: 'closed',
    risk_tags: [],
    evidence_status: 'single_source',
    public_summary: '完全虚构的演示档案，用于验证单一来源的局限性说明，不对应任何真实资料。',
    source_count: 1,
    last_reviewed_at: '2026-01-03T08:00:00Z',
    updated_at: '2026-01-03T08:00:00Z',
  },
  {
    slug: 'fictional-star-field-center',
    name: '虚构示例·星原教育中心',
    aliases: ['虚构示例·星原课堂'],
    region: moonRegion,
    operating_status: 'unknown',
    risk_tags: [],
    evidence_status: 'pending_verification',
    public_summary:
      '完全虚构的中立占位记录：公开资料范围尚待补充。本示例不包含具体指控、线索或身份信息。',
    source_count: 0,
    last_reviewed_at: '2026-01-02T08:00:00Z',
    updated_at: '2026-01-02T08:00:00Z',
  },
  {
    slug: 'fictional-cloud-valley-center',
    name: '虚构示例·云谷研学中心',
    aliases: [],
    region: mistRegion,
    operating_status: 'operating',
    risk_tags: ['no_public_response'],
    evidence_status: 'first_person_statement',
    public_summary:
      '完全虚构的演示档案，用于区分公开陈述与独立核实。示例不包含私人姓名、联系方式或具体指控。',
    source_count: 1,
    last_reviewed_at: '2026-01-01T08:00:00Z',
    updated_at: '2026-01-01T08:00:00Z',
  },
];

export const mockMetadata: MetadataDto = {
  contract_version: '0.1.0',
  regions: [mistRegion, moonRegion],
  evidence_statuses: [
    {
      value: 'official_record',
      label: '官方记录',
      description: '存在公开官方文件，不等同于司法定罪。',
    },
    {
      value: 'multiple_sources',
      label: '多源报道',
      description: '多个独立公开来源，不等同于真实性评分。',
    },
    { value: 'single_source', label: '单一可靠来源', description: '需保留单一来源的局限性说明。' },
    {
      value: 'first_person_statement',
      label: '当事人陈述',
      description: '公开陈述，尚未独立确认。',
    },
    {
      value: 'pending_verification',
      label: '待核实',
      description: '仅公开中立占位，不公开具体指控或原始线索。',
    },
  ],
  risk_tags: [
    { value: 'physical_abuse', label: '暴力或体罚争议', description: '信息分类，不代表认定有罪。' },
    {
      value: 'restriction_of_freedom',
      label: '人身自由限制争议',
      description: '信息分类，不代表认定有罪。',
    },
    {
      value: 'medical_practices',
      label: '医疗或用药争议',
      description: '信息分类，不代表认定有罪。',
    },
    { value: 'fee_dispute', label: '收费或退费纠纷', description: '信息分类，不代表认定有罪。' },
    { value: 'regulatory_action', label: '监管记录', description: '具体事实以公开来源为准。' },
    { value: 'judicial_record', label: '司法记录', description: '不自动推断机构或个人有罪。' },
    {
      value: 'name_or_location_change',
      label: '更名或迁址记录',
      description: '仅展示名称或粗粒度地区变化。',
    },
    {
      value: 'no_public_response',
      label: '尚无公开回应',
      description: '不代表拒绝回应或承认指控。',
    },
  ],
  operating_statuses: [
    { value: 'operating', label: '运营中', description: '有公开资料支持仍在运营。' },
    { value: 'closed', label: '已关闭', description: '有公开资料支持停止运营。' },
    { value: 'relocated', label: '已迁址', description: '不展示精确地址。' },
    { value: 'unknown', label: '运营状态未知', description: '缺乏可靠资料，不能推断。' },
  ],
  source_types: [
    { value: 'news', label: '新闻', description: '公开新闻索引。' },
    { value: 'video', label: '视频', description: '公开视频链接索引。' },
    { value: 'judgment', label: '司法文件', description: '公开司法文件索引。' },
    { value: 'notice', label: '通告', description: '公开通告索引。' },
    { value: 'report', label: '报告', description: '公开报告索引。' },
    { value: 'statement', label: '声明', description: '公开声明索引。' },
  ],
};

export const mockSources: SourceDto[] = mockInstitutions.flatMap((record) =>
  Array.from({ length: record.source_count }, (_, index): SourceDto => ({
    id: `src-${record.slug}-notice-${index + 1}`,
    title: `${record.name}·虚构资料说明 ${index + 1}`,
    publisher: index === 0 ? '虚构示例·公共资料演示署' : '虚构示例·独立资料演示社',
    source_type: 'notice',
    url: `https://example.invalid/${record.slug}/${index + 1}`,
    published_on: '2026-01-01',
    summary: '完全虚构的来源元数据，保留域名链接不可作为实际证据。',
    evidence_status: record.evidence_status,
    link_status: record.operating_status === 'closed' ? 'unavailable' : 'unchecked',
    archive_url: null,
    institution_slugs: [record.slug],
    last_checked_at: null,
    updated_at: record.updated_at,
  })),
);
export const mockTimeline: TimelineDto[] = mockInstitutions.map((record) => ({
  id: `evt-${record.slug}-index`,
  institution_slug: record.slug,
  occurred_on: '2026-01-01',
  occurred_until: null,
  title: '虚构示例·资料索引建立',
  summary: '完全虚构的中立事件，仅演示日期及公开来源引用，不陈述真实指控。',
  evidence_status: record.evidence_status,
  risk_tags: record.risk_tags,
  source_ids: mockSources
    .filter((source) => source.institution_slugs.includes(record.slug))
    .map((source) => source.id),
  response_status: 'none',
  last_reviewed_at: record.last_reviewed_at,
}));
