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
