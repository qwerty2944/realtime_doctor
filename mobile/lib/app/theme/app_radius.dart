import 'package:flutter/widgets.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

/// 모서리 반경 토큰. 카드/입력/다이얼로그/칩이 한 언어를 쓰도록 통일한다.
///
/// 값은 디자인 px. `BorderRadius` 헬퍼는 이미 `.r` 스케일링이 적용돼 있다.
abstract final class AppRadius {
  /// 6 — 칩/뱃지/인용 박스 등 작은 표면.
  static const double sm = 6;

  /// 12 — 카드/입력 필드 기본.
  static const double md = 12;

  /// 16 — 다이얼로그/바텀시트/큰 컨테이너.
  static const double lg = 16;

  /// 24 — 글래스 패널/히어로 컨테이너 등 특대 표면.
  static const double xl = 24;

  /// 999 — pill(완전 둥근) 버튼/칩.
  static const double pill = 999;

  static BorderRadius get smAll => BorderRadius.circular(sm.r);
  static BorderRadius get mdAll => BorderRadius.circular(md.r);
  static BorderRadius get lgAll => BorderRadius.circular(lg.r);
  static BorderRadius get xlAll => BorderRadius.circular(xl.r);
  static BorderRadius get pillAll => BorderRadius.circular(pill);
}
