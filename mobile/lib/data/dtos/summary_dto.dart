class SummaryDto {
  const SummaryDto({
    required this.chiefComplaint,
    required this.historyOfPresentIllness,
    required this.pertinentFindings,
    required this.investigationsMentioned,
    required this.clinicalImpression,
    required this.plan,
    required this.generatedAt,
  });

  final String chiefComplaint;
  final String historyOfPresentIllness;
  final String pertinentFindings;
  final String investigationsMentioned;
  final String clinicalImpression;
  final String plan;
  final String generatedAt;

  factory SummaryDto.fromJson(Map<String, dynamic> j) => SummaryDto(
        chiefComplaint: (j['chief_complaint'] as String?) ?? '',
        historyOfPresentIllness:
            (j['history_of_present_illness'] as String?) ?? '',
        pertinentFindings: (j['pertinent_findings'] as String?) ?? '',
        investigationsMentioned:
            (j['investigations_mentioned'] as String?) ?? '',
        clinicalImpression: (j['clinical_impression'] as String?) ?? '',
        plan: (j['plan'] as String?) ?? '',
        generatedAt: (j['generated_at'] as String?) ??
            DateTime.now().toUtc().toIso8601String(),
      );
}
