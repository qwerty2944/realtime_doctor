import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

import '../../app/theme.dart';

/// 연결된 트랙 위에서 그라데이션 pill 인디케이터가 스와이프에 맞춰 미끄러지는
/// 탭바. 칩처럼 떨어진 개별 버튼이 아니라, 하나의 세그먼트 트랙 안에서
/// 선택 pill 이 탄성있게 이동한다(네이티브 [TabBar] 기반 → 페이지 스와이프와
/// 인디케이터가 실시간 동기화). 탭이 많으면 가로 스크롤하며, 가장자리는
/// 페이드 처리해 글자가 중간에 잘리지 않는다.
class PillTabBar extends StatelessWidget implements PreferredSizeWidget {
  const PillTabBar({required this.controller, required this.labels, super.key});

  final TabController controller;
  final List<String> labels;

  @override
  Size get preferredSize => Size.fromHeight(52.h);

  @override
  Widget build(BuildContext context) {
    final cs = context.colors;
    return Container(
      margin: EdgeInsets.symmetric(horizontal: AppSpacing.md.w),
      padding: EdgeInsets.all(4.r),
      decoration: BoxDecoration(
        // 연결된 트랙 — 탭들이 하나의 컨트롤로 묶여 보이게.
        color: cs.surfaceContainerHighest.withValues(alpha: 0.55),
        borderRadius: AppRadius.pillAll,
        border: Border.all(color: cs.outlineVariant.withValues(alpha: 0.4)),
      ),
      // 가장자리 페이드 — 스크롤된 탭이 글자 중간에 딱 잘리지 않고 부드럽게
      // 사라지게(스크롤 가능한 탭바의 베스트 프랙티스). 트랙 배경은 그대로 두고
      // 라벨(TabBar)만 dstIn 으로 양끝 alpha 를 깎는다.
      child: ShaderMask(
        blendMode: BlendMode.dstIn,
        shaderCallback: (rect) => const LinearGradient(
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
          colors: [
            Colors.transparent,
            Colors.white,
            Colors.white,
            Colors.transparent,
          ],
          stops: [0.0, 0.045, 0.955, 1.0],
        ).createShader(rect),
        child: TabBar(
          controller: controller,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          dividerColor: Colors.transparent,
          indicatorSize: TabBarIndicatorSize.tab,
          // 스와이프에 맞춰 탄성있게 미끄러지는 pill.
          indicatorAnimation: TabIndicatorAnimation.elastic,
          splashBorderRadius: AppRadius.pillAll,
          overlayColor: WidgetStatePropertyAll(
            cs.primary.withValues(alpha: 0.06),
          ),
          indicator: BoxDecoration(
            gradient: LinearGradient(colors: [cs.primary, cs.tertiary]),
            borderRadius: AppRadius.pillAll,
            boxShadow: [
              BoxShadow(
                color: cs.primary.withValues(alpha: 0.32),
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          labelColor: cs.onPrimary,
          unselectedLabelColor: cs.onSurfaceVariant,
          labelStyle: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w700),
          unselectedLabelStyle: TextStyle(
            fontSize: 13.sp,
            fontWeight: FontWeight.w600,
          ),
          labelPadding: EdgeInsets.symmetric(horizontal: AppSpacing.md.w),
          tabs: [for (final l in labels) Tab(height: 36.h, text: l)],
        ),
      ),
    );
  }
}
