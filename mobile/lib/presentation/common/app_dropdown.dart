import 'package:dropdown_button2/dropdown_button2.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../app/theme.dart';

/// 디자인 토큰에 맞춘 공용 드롭다운 (dropdown_button2 기반).
/// 입력 필드처럼 보이는 보더 버튼 + 둥근 팝업 메뉴 + 선택 항목 하이라이트.
class AppDropdown<T> extends StatelessWidget {
  const AppDropdown({
    required this.value,
    required this.items,
    required this.labelOf,
    required this.onChanged,
    this.isExpanded = false,
    super.key,
  });

  final T value;
  final List<T> items;
  final String Function(T) labelOf;
  final ValueChanged<T>? onChanged;
  final bool isExpanded;

  @override
  Widget build(BuildContext context) {
    final cs = context.colors;
    final enabled = onChanged != null;
    return DropdownButtonHideUnderline(
      child: DropdownButton2<T>(
        isExpanded: isExpanded,
        value: value,
        onChanged: enabled ? (v) => v == null ? null : onChanged!(v) : null,
        customButton: Container(
          height: 40.h,
          padding: EdgeInsets.symmetric(horizontal: AppSpacing.md.w),
          decoration: BoxDecoration(
            color: cs.surfaceContainerHighest.withValues(alpha: 0.5),
            borderRadius: AppRadius.mdAll,
            border: Border.all(color: cs.outlineVariant.withValues(alpha: 0.7)),
          ),
          child: Row(
            mainAxisSize: isExpanded ? MainAxisSize.max : MainAxisSize.min,
            children: [
              Flexible(
                child: Text(
                  labelOf(value),
                  overflow: TextOverflow.ellipsis,
                  style: context.cardBody.copyWith(
                    fontWeight: FontWeight.w700,
                    color: enabled ? cs.onSurface : cs.onSurfaceVariant,
                  ),
                ),
              ),
              SizedBox(width: AppSpacing.xs.w),
              Icon(LucideIcons.chevronDown, size: 16.r, color: cs.onSurfaceVariant),
            ],
          ),
        ),
        items: [
          for (final item in items)
            DropdownMenuItem<T>(
              value: item,
              child: Text(
                labelOf(item),
                style: context.cardBody.copyWith(
                  fontWeight: item == value ? FontWeight.w700 : FontWeight.w500,
                  color: item == value ? cs.primary : cs.onSurface,
                ),
              ),
            ),
        ],
        dropdownStyleData: DropdownStyleData(
          maxHeight: 320.h,
          // width 미지정 → 메뉴 폭이 버튼 폭에 맞춰진다(풀폭 버튼과 정렬).
          padding: EdgeInsets.symmetric(vertical: AppSpacing.xs.h),
          elevation: 4,
          offset: Offset(0, -4.h),
          decoration: BoxDecoration(
            color: cs.surfaceContainerHigh,
            borderRadius: AppRadius.lgAll,
            border: Border.all(color: cs.outlineVariant.withValues(alpha: 0.5)),
          ),
        ),
        menuItemStyleData: MenuItemStyleData(
          height: 44.h,
          selectedMenuItemBuilder: (context, child) => ColoredBox(
            color: cs.primary.withValues(alpha: 0.10),
            child: child,
          ),
        ),
      ),
    );
  }
}
