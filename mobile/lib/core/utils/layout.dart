import 'package:flutter/widgets.dart';

/// Glassmorphism 하단 탭바 관련 레이아웃 헬퍼.
///
/// `MainShell` 이 `extendBody: true` 로 콘텐츠를 반투명 탭바 뒤까지 그리므로,
/// 스크롤 뷰는 마지막 항목이 탭바에 가려지지 않도록 하단 패딩을 확보해야 한다.
extension GlassNavBarLayout on BuildContext {
  /// M3 `NavigationBar` 기본 본체 높이 (logical px — ScreenUtil 스케일 미적용).
  static const double navBarHeight = 80;

  /// 글래스 탭바가 콘텐츠를 가리는 전체 높이 = 본체 + 하단 시스템 인셋.
  double get glassNavBarInset =>
      navBarHeight + MediaQuery.viewPaddingOf(this).bottom;
}
