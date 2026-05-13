import 'package:intl/intl.dart';

String formatSessionStart(DateTime dt, {String locale = 'ko'}) {
  final local = dt.toLocal();
  final fmt = DateFormat.yMMMd(locale).add_Hm();
  return fmt.format(local);
}

String formatTimeOnly(DateTime dt) {
  final local = dt.toLocal();
  return DateFormat('HH:mm:ss').format(local);
}
