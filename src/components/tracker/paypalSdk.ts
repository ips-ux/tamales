// Loads the PayPal JS SDK 1 time, on demand. Browser only.

import { paypalClientId, paypalSdkUrl } from "./payRules";

export interface PayPalButtonsInstance {
  render: (container: HTMLElement) => Promise<void>;
  close: () => Promise<void>;
  isEligible?: () => boolean;
}

export interface PayPalButtonsOptions {
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }) => Promise<void>;
  onCancel?: () => void;
  onError?: (error: unknown) => void;
}

export interface PayPalNamespace {
  Buttons: (options: PayPalButtonsOptions) => PayPalButtonsInstance;
}

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

/** The PayPal client id of this build. Empty when online payment is not set up. */
export function configuredPayPalClientId(): string {
  return paypalClientId(import.meta.env.VITE_PAYPAL_CLIENT_ID);
}

let pending: Promise<PayPalNamespace> | null = null;

/** Adds the SDK script to the page 1 time. A failed load can be tried again. */
export function loadPayPalSdk(clientId: string): Promise<PayPalNamespace> {
  if (window.paypal) return Promise.resolve(window.paypal);
  if (pending) return pending;
  pending = new Promise<PayPalNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = paypalSdkUrl(clientId);
    script.async = true;
    script.onload = () => {
      if (window.paypal) resolve(window.paypal);
      else reject(new Error("The PayPal SDK did not start."));
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("The PayPal SDK did not load."));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}
