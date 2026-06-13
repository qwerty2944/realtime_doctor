import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../generated/l10n/app_localizations.dart';
import '../../common/auth_scaffold.dart';
import '../controllers/auth_controller.dart';

class SignupScreen extends ConsumerStatefulWidget {
  const SignupScreen({super.key});

  @override
  ConsumerState<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends ConsumerState<SignupScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final t = AppLocalizations.of(context);
    if (_password.text != _confirm.text) {
      setState(() => _error = t.passwordMismatch);
      return;
    }
    if (_password.text.length < 6) {
      setState(() => _error = t.passwordTooShort);
      return;
    }
    final failure = await ref
        .read(authControllerProvider.notifier)
        .signUp(_email.text.trim(), _password.text);
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
          decoration: InputDecoration(
            labelText: t.email,
            prefixIcon: const Icon(LucideIcons.atSign),
          ),
        ),
        SizedBox(height: AppSpacing.md.h),
        TextField(
          controller: _password,
          obscureText: true,
          decoration: InputDecoration(
            labelText: t.password,
            prefixIcon: const Icon(LucideIcons.lock),
          ),
        ),
        SizedBox(height: AppSpacing.md.h),
        TextField(
          controller: _confirm,
          obscureText: true,
          decoration: InputDecoration(
            labelText: t.passwordConfirm,
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
              : Text(t.signUp),
        ),
        SizedBox(height: AppSpacing.sm.h),
        TextButton(
          onPressed: () => context.go('/auth/login'),
          child: Text(t.toLogin),
        ),
      ],
    );
  }
}
