import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../env/env.dart';

part 'supabase_client_provider.g.dart';

/// Supabase는 main()에서 Supabase.initialize 가 이미 호출되어 있음.
/// 이 provider 는 Supabase.instance.client 를 그래프에 노출.
@Riverpod(keepAlive: true)
SupabaseClient supabaseClient(SupabaseClientRef ref) {
  // env 의존성을 명시적으로 watch — 초기화 순서를 그래프 차원에서 강제.
  ref.watch(envProvider);
  return Supabase.instance.client;
}

@riverpod
Stream<AuthState> authStateChanges(AuthStateChangesRef ref) {
  return ref.watch(supabaseClientProvider).auth.onAuthStateChange;
}

@riverpod
Session? currentSession(CurrentSessionRef ref) {
  final auth = ref.watch(authStateChangesProvider);
  // 최신 상태 또는 현재 client 상태로 fallback.
  return auth.valueOrNull?.session ??
      ref.watch(supabaseClientProvider).auth.currentSession;
}
