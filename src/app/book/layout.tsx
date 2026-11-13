import { FlapCurtain } from "@/features/booking/curtain/FlapCurtain";

// The booking flow shares one page change: the booking page closes into a
// board of flaps that opens again on the confirmation.
export default function BookLayout({ children }: { children: React.ReactNode }) {
  return (
    <FlapCurtain>
      <div className="nt">{children}</div>
    </FlapCurtain>
  );
}
