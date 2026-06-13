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
        // 모델 출력 모양이 들쭉날쭉할 수 있어 방어적으로 파싱한다(잘못된 요소는
        // 건너뛰고, List 가 아니면 빈 목록). cast 로 즉시 throw 하지 않는다.
        differentialDiagnoses: _objects(j['differential_diagnoses']),
        medicalTerms: _objects(j['medical_terms']),
        suggestedQuestions: _objects(j['suggested_questions']),
        redFlags: (j['red_flags'] is List ? j['red_flags'] as List : const [])
            .whereType<String>()
            .toList(),
        updatedAt: (j['updated_at'] as String?) ??
            DateTime.now().toUtc().toIso8601String(),
      );

  /// 값이 List 면 그 안의 객체(Map)만 골라낸다. 그 외(String/null/Map)는 빈 목록.
  static List<Map<String, dynamic>> _objects(dynamic v) =>
      (v is List ? v : const [])
          .whereType<Map>()
          .map((e) => e.cast<String, dynamic>())
          .toList();
}
