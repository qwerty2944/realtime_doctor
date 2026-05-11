import type { RealtimeDoctorApi } from '../../preload/index';

declare global {
  interface Window {
    api: RealtimeDoctorApi;
  }
}

export {};
