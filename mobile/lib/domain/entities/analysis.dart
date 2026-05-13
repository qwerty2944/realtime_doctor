import 'package:equatable/equatable.dart';

class DifferentialDiagnosis extends Equatable {
  const DifferentialDiagnosis({
    required this.name,
    required this.confidence,
    required this.reasoning,
    this.nameEn,
    this.icd10,
  });

  final String name;
  final String? nameEn;
  final String? icd10;
  final double confidence;
  final String reasoning;

  @override
  List<Object?> get props => [name, nameEn, icd10, confidence, reasoning];
}

class MedicalTerm extends Equatable {
  const MedicalTerm({
    required this.term,
    required this.definition,
    this.termEn,
    this.contextQuote,
  });

  final String term;
  final String? termEn;
  final String definition;
  final String? contextQuote;

  @override
  List<Object?> get props => [term, termEn, definition, contextQuote];
}

class SuggestedQuestion extends Equatable {
  const SuggestedQuestion({required this.question, required this.rationale});
  final String question;
  final String rationale;

  @override
  List<Object?> get props => [question, rationale];
}

class Analysis extends Equatable {
  const Analysis({
    required this.differentialDiagnoses,
    required this.medicalTerms,
    required this.suggestedQuestions,
    required this.redFlags,
    required this.updatedAt,
  });

  final List<DifferentialDiagnosis> differentialDiagnoses;
  final List<MedicalTerm> medicalTerms;
  final List<SuggestedQuestion> suggestedQuestions;
  final List<String> redFlags;
  final DateTime updatedAt;

  bool get isEmpty =>
      differentialDiagnoses.isEmpty &&
      medicalTerms.isEmpty &&
      suggestedQuestions.isEmpty &&
      redFlags.isEmpty;

  @override
  List<Object?> get props => [
        differentialDiagnoses,
        medicalTerms,
        suggestedQuestions,
        redFlags,
        updatedAt,
      ];
}
