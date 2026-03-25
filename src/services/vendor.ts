import { invoke } from '@tauri-apps/api/core';

export async function addVendorApi(
  vendor: string,
  apiKey: string,
  apiBaseUrl: string
): Promise<void> {
  return invoke('add_vendor_api', { vendor, apiKey, apiBaseUrl });
}

export async function removeVendor(vendor: string): Promise<void> {
  return invoke('remove_vendor', { vendor });
}

export async function setVendorApi(
  vendor: string,
  apiKey: string,
  apiBaseUrl: string
): Promise<void> {
  return invoke('set_vendor_api', { vendor, apiKey, apiBaseUrl });
}

export async function getVendorApi(
  vendor: string
): Promise<[string, string] | null> {
  return invoke<[string, string] | null>('get_vendor_api', { vendor });
}
