import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../app/theme.dart';
import '../../generated/l10n/app_localizations.dart';

/// 한 섹션짜리 편집 가능한 텍스트 카드.
///
/// 읽기/편집 토글, 복사, 더티 표시(amber dot)를 한 위젯에 담는다.
/// Summary, Dictation 양쪽에서 재사용.
class EditableTextSection extends StatefulWidget {
  const EditableTextSection({
    required this.heading,
    required this.body,
    required this.onSave,
    this.dirty = false,
    super.key,
  });

  /// 섹션 제목 (예: "주호소", "Plan").
  final String heading;

  /// 표시/편집 대상 본문. 부모가 항상 최신값을 내려준다.
  final String body;

  /// 저장 시 상위로 통보. 부모가 draft 상태를 갱신해야 한다.
  final ValueChanged<String> onSave;

  /// 외부에서 더티(편집됨) 여부 표시를 줄 때 사용.
  final bool dirty;

  @override
  State<EditableTextSection> createState() => _EditableTextSectionState();
}

class _EditableTextSectionState extends State<EditableTextSection> {
  bool _editing = false;
  late TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.body);
  }

  @override
  void didUpdateWidget(covariant EditableTextSection old) {
    super.didUpdateWidget(old);
    // 외부에서 body 가 갱신되면(예: 재생성) 편집 중이 아닐 때만 동기화.
    if (!_editing && old.body != widget.body) {
      _controller.text = widget.body;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _enterEdit() {
    setState(() {
      _controller.text = widget.body;
      _editing = true;
    });
  }

  void _cancelEdit() {
    setState(() {
      _controller.text = widget.body;
      _editing = false;
    });
  }

  void _save() {
    final next = _controller.text;
    setState(() => _editing = false);
    widget.onSave(next);
  }

  Future<void> _copy(AppLocalizations t) async {
    await Clipboard.setData(ClipboardData(text: widget.body));
    if (!mounted) return;
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(t.copied),
        duration: const Duration(milliseconds: 1200),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final cs = Theme.of(context).colorScheme;

    return Padding(
      padding: EdgeInsets.only(bottom: 14.h),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Row(
                  children: [
                    Flexible(
                      child: Text(widget.heading, style: context.sectionLabel),
                    ),
                    if (widget.dirty) ...[
                      SizedBox(width: 6.w),
                      Container(
                        width: 6.r,
                        height: 6.r,
                        decoration: BoxDecoration(
                          color: context.tokens.dirty,
                          shape: BoxShape.circle,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (!_editing) ...[
                IconButton(
                  visualDensity: VisualDensity.compact,
                  padding: EdgeInsets.zero,
                  constraints: BoxConstraints(minWidth: 32.r, minHeight: 32.r),
                  iconSize: 16.r,
                  onPressed: _enterEdit,
                  icon: Icon(LucideIcons.pencil, color: cs.outline),
                  tooltip: t.edit,
                ),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  padding: EdgeInsets.zero,
                  constraints: BoxConstraints(minWidth: 32.r, minHeight: 32.r),
                  iconSize: 16.r,
                  onPressed: () => _copy(t),
                  icon: Icon(LucideIcons.copy, color: cs.outline),
                  tooltip: t.copy,
                ),
              ],
            ],
          ),
          SizedBox(height: 4.h),
          const Divider(height: 1),
          SizedBox(height: 6.h),
          if (_editing) ...[
            TextField(
              controller: _controller,
              maxLines: null,
              minLines: 3,
              style: context.cardBody,
              decoration: const InputDecoration(isDense: true),
            ),
            SizedBox(height: 6.h),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(onPressed: _cancelEdit, child: Text(t.cancel)),
                SizedBox(width: 4.w),
                FilledButton.tonal(onPressed: _save, child: Text(t.save)),
              ],
            ),
          ] else
            Text(
              widget.body.isEmpty ? '—' : widget.body,
              style: context.cardBody,
            ),
        ],
      ),
    );
  }
}
