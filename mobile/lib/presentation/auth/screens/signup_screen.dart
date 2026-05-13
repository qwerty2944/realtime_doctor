import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:go_router/go_router.dart';

import '../../../generated/l10n/app_localizations.dart';
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
    if (_password.text != _confirm.text) {
      setState(() => _error = 'Passwords do not match');
      return;
    }
    if (_password.text.length < 6) {
      setState(() => _error = 'Password must be at least 6 characters');
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
    return Scaffold(
      appBar: AppBar(title: Text(t.signupTitle)),
      body: SafeArea(
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: 24.w, vertical: 24.h),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                decoration: InputDecoration(labelText: t.email),
              ),
              SizedBox(height: 12.h),
              TextField(
                controller: _password,
                obscureText: true,
                decoration: InputDecoration(labelText: t.password),
              ),
              SizedBox(height: 12.h),
              TextField(
                controller: _confirm,
                obscureText: true,
                decoration: InputDecoration(labelText: t.passwordConfirm),
              ),
              if (_error != null) ...[
                SizedBox(height: 12.h),
                Text(
                  _error!,
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.error,
                    fontSize: 12.sp,
                  ),
                ),
              ],
              SizedBox(height: 20.h),
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
              SizedBox(height: 12.h),
              TextButton(
                onPressed: () => context.go('/auth/login'),
                child: Text(t.toLogin),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
