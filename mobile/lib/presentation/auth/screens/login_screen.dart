import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../generated/l10n/app_localizations.dart';
import '../../common/auth_scaffold.dart';
import '../controllers/auth_controller.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final failure = await ref
        .read(authControllerProvider.notifier)
        .signIn(_email.text.trim(), _password.text);
    if (!mounted) return;
    if (failure != null) {
      setState(() => _error = failure.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final loading = ref.watch(authControllerProvider).isLoading;

    return AuthScaffold(
      children: [
        TextField(
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          autofillHints: const [AutofillHints.email],
          decoration: InputDecoration(
            labelText: t.email,
            prefixIcon: const Icon(LucideIcons.atSign),
          ),
        ),
        SizedBox(height: AppSpacing.md.h),
        TextField(
          controller: _password,
          obscureText: true,
          autofillHints: const [AutofillHints.password],
          decoration: InputDecoration(
            labelText: t.password,
            prefixIcon: const Icon(LucideIcons.lock),
          ),
        ),
        if (_error != null) AuthErrorText(_error!),
        SizedBox(height: AppSpacing.xl.h),
        FilledButton(
          onPressed: loading ? null : _submit,
          child: loading
              ? SizedBox(
                  width: 18.r,
                  height: 18.r,
                  child: const CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(t.signIn),
        ),
        SizedBox(height: AppSpacing.sm.h),
        TextButton(
          onPressed: () => context.go('/auth/signup'),
          child: Text(t.toSignup),
        ),
      ],
    );
  }
}
