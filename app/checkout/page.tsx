import type { Metadata } from "next";
import CheckoutFlow from "@/components/CheckoutFlow";

export const metadata: Metadata = {
  title: "Checkout · WECAMETOOPARTY",
  description: "Review your order, enter your details and get your tickets.",
  robots: { index: false },
};

export default function CheckoutPage() {
  return <CheckoutFlow />;
}
