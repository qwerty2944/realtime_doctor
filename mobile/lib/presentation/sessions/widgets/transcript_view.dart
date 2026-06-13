import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

import '../../../app/theme.dart';
import '../../../core/utils/date_format.dart';
import '../../../domain/entities/speaker.dart';
import '../../../domain/entities/transcript_chunk.dart';
import '../../../generated/l10n/app_localizations.dart';
import '../../common/tag_chip.dart';

class TranscriptView extends StatefulWidget {
  const TranscriptView({
    required this.chunks,
    this.bottomInset = 0,
    this.onRelabel,
    this.onDelete,
    this.activeChunkId,
    super.key,
  });

  final List<TranscriptChunk> chunks;

  /// 글래스 탭바 뒤로 마지막 발화가 가려지지 않도록 줄 하단 여백.
  final double bottomInset;

  /// 탭하면 화자 재라벨 시 호출. null 이면 메뉴 비활성(세션 상세 read-only).
  final void Function(String chunkId, Speaker next)? onRelabel;

  /// 발화 삭제 콜백. null 이면 시트에 삭제 항목을 띄우지 않는다.
  final void Function(String chunkId)? onDelete;

  /// 오디오 재생 중 현재 위치에 해당하는 발화 id — 강조 + 자동 스크롤.
  final String? activeChunkId;

  @override
  State<TranscriptView> createState() => _TranscriptViewState();
}

class _TranscriptViewState extends State<TranscriptView> {
  final ScrollController _controller = ScrollController();
  final Map<String, GlobalKey> _keys = {};

  GlobalKey _keyFor(String id) => _keys.putIfAbsent(id, GlobalKey.new);

  @override
  void didUpdateWidget(TranscriptView old) {
    super.didUpdateWidget(old);
    final id = widget.activeChunkId;
    if (id != null && id != old.activeChunkId) {
      // 재생 위치가 바뀌면 해당 발화를 화면 중앙으로 부드럽게 스크롤.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final ctx = _keys[id]?.currentContext;
        if (ctx != null) {
          Scrollable.ensureVisible(
            ctx,
            alignment: 0.4,
            duration: const Duration(milliseconds: 300),
            curve: Curves.easeOutCubic,
          );
        }
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  ({Color accent, String label}) _styleFor(
    Speaker s,
    AppLocalizations t,
    AppTokens tk,
  ) {
    return switch (s) {
      Speaker.doctor => (accent: tk.speakerDoctor, label: t.speakerDoctor),
      Speaker.patient => (accent: tk.speakerPatient, label: t.speakerPatient),
      Speaker.unknown => (accent: tk.speakerUnknown, label: t.speakerUnknown),
    };
  }

  Future<void> _showRelabelSheet(String chunkId, AppLocalizations t) async {
    final picked = await showModalBottomSheet<Speaker>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: EdgeInsets.symmetric(
                vertical: AppSpacing.md.h,
                horizontal: AppSpacing.lg.w,
              ),
              child: Text(t.relabelTitle, style: ctx.cardTitle),
            ),
            const Divider(height: 1),
            for (final opt in [
              (Speaker.doctor, t.relabelDoctor),
              (Speaker.patient, t.relabelPatient),
              (Speaker.unknown, t.relabelUnknown),
            ])
              ListTile(
                title: Text(opt.$2),
                onTap: () => Navigator.pop(ctx, opt.$1),
              ),
            // 발화 삭제 — 빨강. 캡처처럼 onDelete 가 있을 때만.
            if (widget.onDelete != null) ...[
              const Divider(height: 1),
              ListTile(
                leading: Icon(Icons.delete_outline, color: ctx.colors.error),
                title: Text(t.delete, style: TextStyle(color: ctx.colors.error)),
                onTap: () {
                  Navigator.pop(ctx);
                  widget.onDelete!(chunkId);
                },
              ),
            ],
          ],
        ),
      ),
    );
    if (picked != null) widget.onRelabel?.call(chunkId, picked);
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final tk = context.tokens;
    if (widget.chunks.isEmpty) {
      return Center(child: Text(t.noData, style: context.caption));
    }
    final canAct = widget.onRelabel != null || widget.onDelete != null;
    return ListView.builder(
      controller: _controller,
      padding: EdgeInsets.fromLTRB(
        AppSpacing.md.r,
        AppSpacing.md.r,
        AppSpacing.md.r,
        AppSpacing.md.r + widget.bottomInset,
      ),
      itemCount: widget.chunks.length,
      itemBuilder: (_, i) {
        final c = widget.chunks[i];
        final s = _styleFor(c.speaker, t, tk);
        final active = c.id == widget.activeChunkId;
        return GestureDetector(
          key: _keyFor(c.id),
          // 발화를 탭(또는 길게 누름)하면 화자 변경/삭제 시트.
          onTap: canAct ? () => _showRelabelSheet(c.id, t) : null,
          onLongPress: canAct ? () => _showRelabelSheet(c.id, t) : null,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
            margin: EdgeInsets.only(bottom: AppSpacing.sm.h),
            padding: EdgeInsets.all(AppSpacing.md.r),
            decoration: BoxDecoration(
              // 재생 중 활성 발화는 더 진한 틴트 + 전체 보더로 강조.
              color: s.accent.withValues(alpha: active ? 0.24 : 0.10),
              borderRadius: AppRadius.mdAll,
              border: active
                  ? Border.all(color: s.accent, width: 1.6)
                  : Border(
                      left: BorderSide(
                        color: s.accent.withValues(alpha: 0.7),
                        width: 3,
                      ),
                    ),
              boxShadow: active
                  ? [
                      BoxShadow(
                        color: s.accent.withValues(alpha: 0.3),
                        blurRadius: 12,
                      ),
                    ]
                  : null,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    TagChip(label: s.label, color: s.accent),
                    SizedBox(width: AppSpacing.sm.w),
                    Text(formatTimeOnly(c.timestamp), style: context.monoTime),
                    if (active) ...[
                      SizedBox(width: AppSpacing.sm.w),
                      Icon(
                        Icons.volume_up_rounded,
                        size: 15.r,
                        color: s.accent,
                      ),
                    ],
                    if (canAct) ...[
                      const Spacer(),
                      Icon(
                        Icons.unfold_more,
                        size: 16.r,
                        color: context.colors.onSurfaceVariant,
                      ),
                    ],
                  ],
                ),
                SizedBox(height: AppSpacing.xs.h),
                Text(c.text, style: context.cardBody),
              ],
            ),
          ),
        );
      },
    );
  }
}
