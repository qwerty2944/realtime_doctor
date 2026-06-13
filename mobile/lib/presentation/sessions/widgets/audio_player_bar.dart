import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:just_audio/just_audio.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/utils/layout.dart';
import '../../../generated/l10n/app_localizations.dart';
import '../../../infrastructure/audio/audio_player_provider.dart';
import '../../common/empty_view.dart';

class AudioPlayerBar extends ConsumerStatefulWidget {
  const AudioPlayerBar({required this.signedUrl, super.key});
  final String? signedUrl;

  @override
  ConsumerState<AudioPlayerBar> createState() => _AudioPlayerBarState();
}

class _AudioPlayerBarState extends ConsumerState<AudioPlayerBar> {
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (widget.signedUrl == null) return;
    final p = ref.read(audioPlayerProvider);
    try {
      await p.setUrl(widget.signedUrl!);
      setState(() => _loaded = true);
    } catch (_) {
      // ignore
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    if (widget.signedUrl == null) {
      return EmptyView(message: t.audioNotAvailable, icon: LucideIcons.fileX);
    }
    final player = ref.read(audioPlayerProvider);

    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.lg.r,
        AppSpacing.lg.r,
        AppSpacing.lg.r,
        AppSpacing.lg.r + context.glassNavBarInset,
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          StreamBuilder<PlayerState>(
            stream: player.playerStateStream,
            builder: (_, snap) {
              final playing = snap.data?.playing ?? false;
              return IconButton.filled(
                iconSize: 36.r,
                style: IconButton.styleFrom(
                  padding: EdgeInsets.all(AppSpacing.md.r),
                ),
                onPressed: !_loaded
                    ? null
                    : () => playing ? player.pause() : player.play(),
                icon: Icon(
                  playing ? Icons.pause_rounded : Icons.play_arrow_rounded,
                ),
              );
            },
          ),
          SizedBox(height: AppSpacing.md.h),
          StreamBuilder<Duration?>(
            stream: player.durationStream,
            builder: (_, durSnap) {
              final dur = durSnap.data ?? Duration.zero;
              return StreamBuilder<Duration>(
                stream: player.positionStream,
                builder: (_, posSnap) {
                  final pos = posSnap.data ?? Duration.zero;
                  return Column(
                    children: [
                      Slider(
                        max: dur.inMilliseconds.toDouble().clamp(
                          1,
                          double.infinity,
                        ),
                        value: pos.inMilliseconds.toDouble().clamp(
                          0,
                          dur.inMilliseconds.toDouble(),
                        ),
                        onChanged: !_loaded
                            ? null
                            : (v) => player.seek(
                                Duration(milliseconds: v.toInt()),
                              ),
                      ),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(_fmt(pos), style: context.monoTime),
                          Text(_fmt(dur), style: context.monoTime),
                        ],
                      ),
                    ],
                  );
                },
              );
            },
          ),
        ],
      ),
    );
  }

  String _fmt(Duration d) {
    final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '${d.inHours > 0 ? '${d.inHours}:' : ''}$m:$s';
  }
}
