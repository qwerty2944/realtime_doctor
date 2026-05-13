enum Speaker {
  doctor,
  patient,
  unknown;

  static Speaker fromString(String? v) => switch (v) {
        'doctor' => Speaker.doctor,
        'patient' => Speaker.patient,
        _ => Speaker.unknown,
      };

  String get wire => switch (this) {
        Speaker.doctor => 'doctor',
        Speaker.patient => 'patient',
        Speaker.unknown => 'unknown',
      };

  Speaker get toggle => switch (this) {
        Speaker.doctor => Speaker.patient,
        Speaker.patient => Speaker.doctor,
        Speaker.unknown => Speaker.doctor,
      };
}
