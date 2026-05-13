class AnalysisDto {
  const AnalysisDto({
    required this.differentialDiagnoses,
    required this.medicalTerms,
    required this.suggestedQuestions,
    required this.redFlags,
    required this.updatedAt,
  });

  final List<Map<String, dynamic>> differentialDiagnoses;
  final List<Map<String, dynamic>> medicalTerms;
  final List<Map<String, dynamic>> suggestedQuestions;
  final List<String> redFlags;
  final String updatedAt;

  factory AnalysisDto.fromJson(Map<String, dynamic> j) => AnalysisDto(
        differentialDiagnoses: (j['differential_diagnoses'] as List? ?? [])
            .cast<Map<String, dynamic>>(),
        medicalTerms:
            (j['medical_terms'] as List? ?? []).cast<Map<String, dynamic>>(),
        suggestedQuestions: (j['suggested_questions'] as List? ?? [])
            .cast<Map<String, dynamic>>(),
        redFlags: (j['red_flags'] as List? ?? []).cast<String>(),
        updatedAt: (j['updated_at'] as String?) ??
            DateTime.now().toUtc().toIso8601String(),
      );
}
