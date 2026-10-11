import type { EvidenceStatus, OperatingStatus, RiskTag } from './models';

export const evidenceLabels: Record<EvidenceStatus, string> = {
  official_record: '官方记录',
  multiple_sources: '多源报道',
  single_source: '单一可靠来源',
  first_person_statement: '当事人陈述',
  pending_verification: '待核实',
};
export const operatingLabels: Record<OperatingStatus, string> = {
  operating: '运营中',
  closed: '已关闭',
  relocated: '已迁址',
  unknown: '运营状态未知',
};
export const riskLabels: Record<RiskTag, string> = {
  physical_abuse: '暴力或体罚争议',
  restriction_of_freedom: '人身自由限制争议',
  medical_practices: '医疗或用药争议',
  fee_dispute: '收费或退费纠纷',
  regulatory_action: '监管记录',
  judicial_record: '司法记录',
  name_or_location_change: '更名或迁址记录',
  no_public_response: '尚无公开回应',
};
export function formatDate(value: string | null): string {
  if (!value) return '日期未知';
  return value.slice(0, 10).replaceAll('-', '.');
}
