import '../../domain/entities/analysis.dart';
import '../../domain/entities/dictation.dart';
import '../../domain/entities/summary.dart';
import '../dtos/analysis_dto.dart';
import '../dtos/dictation_dto.dart';
import '../dtos/summary_dto.dart';

extension AnalysisDtoX on AnalysisDto {
  Analysis toDomain() => Analysis(
        differentialDiagnoses: differentialDiagnoses
            .map(
              (j) => DifferentialDiagnosis(
                name: (j['name'] as String?) ?? '',
                nameEn: j['nameEn'] as String?,
                icd10: j['icd10'] as String?,
                confidence: (j['confidence'] as num?)?.toDouble() ?? 0.0,
                reasoning: (j['reasoning'] as String?) ?? '',
              ),
            )
            .toList(),
        medicalTerms: medicalTerms
            .map(
              (j) => MedicalTerm(
                term: (j['term'] as String?) ?? '',
                termEn: j['termEn'] as String?,
                definition: (j['definition'] as String?) ?? '',
                contextQuote: j['contextQuote'] as String?,
              ),
            )
            .toList(),
        suggestedQuestions: suggestedQuestions
            .map(
              (j) => SuggestedQuestion(
                question: (j['question'] as String?) ?? '',
                rationale: (j['rationale'] as String?) ?? '',
              ),
            )
            .toList(),
        redFlags: redFlags,
        updatedAt: DateTime.parse(updatedAt),
      );
}

extension SummaryDtoX on SummaryDto {
  Summary toDomain() => Summary(
        chiefComplaint: chiefComplaint,
        historyOfPresentIllness: historyOfPresentIllness,
        pertinentFindings: pertinentFindings,
        investigationsMentioned: investigationsMentioned,
        clinicalImpression: clinicalImpression,
        plan: plan,
        generatedAt: DateTime.parse(generatedAt),
      );
}

extension DictationDtoX on DictationDto {
  Dictation toDomain() => Dictation(
        template: DictationTemplate.fromString(template),
        sections: sections
            .map(
              (j) => DictationSection(
                heading: (j['heading'] as String?) ?? '',
                body: (j['body'] as String?) ?? '',
              ),
            )
            .toList(),
        generatedAt: DateTime.parse(generatedAt),
      );
}
