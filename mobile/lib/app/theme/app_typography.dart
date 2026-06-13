import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

import 'app_tokens.dart';

/// 시맨틱 텍스트 스타일. 화면 곳곳의 하드코딩된 `fontSize`/`letterSpacing` 을 대체한다.
///
/// 색은 현재 테마의 ColorScheme 에서 가져오므로 다크모드에서 자동 적응한다.
extension AppTextStyles on BuildContext {
  /// 섹션/필드 위 작은 라벨. 예: "DEFINITION", "CONTEXT", 설정 그룹 헤더.
  TextStyle get sectionLabel => TextStyle(
    fontSize: 11.sp,
    fontWeight: FontWeight.w700,
    letterSpacing: 0.6,
    color: colors.onSurfaceVariant,
  );

  /// 카드/항목 제목.
  TextStyle get cardTitle => TextStyle(
    fontSize: 14.sp,
    fontWeight: FontWeight.w700,
    height: 1.3,
    color: colors.onSurface,
  );

  /// 본문 텍스트(전사/정의/근거 등).
  TextStyle get cardBody =>
      TextStyle(fontSize: 13.sp, height: 1.45, color: colors.onSurface);

  /// 보조 설명/메타데이터.
  TextStyle get caption =>
      TextStyle(fontSize: 11.sp, height: 1.35, color: colors.onSurfaceVariant);

  /// 인용/예시(이탤릭).
  TextStyle get quote => TextStyle(
    fontSize: 12.sp,
    height: 1.4,
    fontStyle: FontStyle.italic,
    color: colors.onSurfaceVariant,
  );

  /// 타이머/시간 표시(고정폭 숫자).
  TextStyle get monoTime => TextStyle(
    fontSize: 11.sp,
    color: colors.onSurfaceVariant,
    fontFeatures: const [FontFeature.tabularFigures()],
  );
}
