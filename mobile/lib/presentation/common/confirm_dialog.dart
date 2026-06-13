import 'package:flutter/material.dart';

/// 공통 확인 다이얼로그. 요약/작성문 재생성 등 파괴적 동작 전 확인에 사용.
///
/// `true` = 확인, `false`/`null` = 취소.
Future<bool> showConfirmDialog(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  required String cancelLabel,
  bool destructive = false,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (context) {
      final cs = Theme.of(context).colorScheme;
      return AlertDialog(
        title: Text(title),
        content: Text(message),
        // 버튼이 한 줄에 균형있게 — 파괴적 동작은 솔리드 빨강 대신 빨강 텍스트
        // 버튼(취소와 같은 텍스트 버튼 톤)으로 맞춰 레이아웃이 들쭉날쭉하지 않게.
        actionsPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(cancelLabel),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: destructive
                ? TextButton.styleFrom(foregroundColor: cs.error)
                : null,
            child: Text(
              confirmLabel,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      );
    },
  );
  return result ?? false;
}
