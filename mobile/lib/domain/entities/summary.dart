import 'package:equatable/equatable.dart';

class Summary extends Equatable {
  const Summary({
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
  final DateTime generatedAt;

  Summary copyWith({
    String? chiefComplaint,
    String? historyOfPresentIllness,
    String? pertinentFindings,
    String? investigationsMentioned,
    String? clinicalImpression,
    String? plan,
    DateTime? generatedAt,
  }) =>
      Summary(
        chiefComplaint: chiefComplaint ?? this.chiefComplaint,
        historyOfPresentIllness:
            historyOfPresentIllness ?? this.historyOfPresentIllness,
        pertinentFindings: pertinentFindings ?? this.pertinentFindings,
        investigationsMentioned:
            investigationsMentioned ?? this.investigationsMentioned,
        clinicalImpression: clinicalImpression ?? this.clinicalImpression,
        plan: plan ?? this.plan,
        generatedAt: generatedAt ?? this.generatedAt,
      );

  @override
  List<Object?> get props => [
        chiefComplaint,
        historyOfPresentIllness,
        pertinentFindings,
        investigationsMentioned,
        clinicalImpression,
        plan,
        generatedAt,
      ];
}
