/// 간격 스케일 토큰. 모든 padding/gap 은 이 값에서 고른다.
///
/// 값은 디자인 px(390 기준). 호출부에서 `.w`/`.h`/`.r` 로 screenutil 스케일링한다.
/// 예) `EdgeInsets.all(AppSpacing.md.r)`, `SizedBox(height: AppSpacing.sm.h)`.
abstract final class AppSpacing {
  /// 4 — 아이콘-텍스트 사이 등 극소 간격.
  static const double xs = 4;

  /// 8 — 기본 인접 요소 간격.
  static const double sm = 8;

  /// 12 — 카드 내부 패딩 / 리스트 항목 간격.
  static const double md = 12;

  /// 16 — 화면 가로 여백 / 섹션 내부 패딩.
  static const double lg = 16;

  /// 20 — 섹션 사이 간격.
  static const double xl = 20;

  /// 24 — 폼/페이지 가로 여백.
  static const double xxl = 24;

  /// 32 — 큰 헤드라인 위아래 호흡.
  static const double xxxl = 32;
}
