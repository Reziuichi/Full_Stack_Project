import type { Metadata } from "next";
import { AboutJourney } from "@/features/about/AboutJourney";

export const metadata: Metadata = {
  title: "About",
  description:
    "Longitude is a travel desk on a live Earth, planned in Chandigarh. How we started, how the 3D globe works, our cancellation policy and how to reach a planner.",
};

const POLICIES = [
  ["30+ days before departure", "Full refund of the deposit, or move your dates once at no charge."],
  ["15–29 days", "50% of the deposit is refundable; hotel penalties are passed on at cost."],
  ["Under 15 days", "Non-refundable, but we will try to resell your place and refund what we recover."],
  ["Taxes & tickets", "Prices include 5% GST on tour packages. Flights and visas are always booked separately so you keep full control of them."],
];

export default function AboutPage() {
  return (
    <>
      <AboutJourney />

      <section id="policies" aria-labelledby="policies-title" className="ab-after scroll-mt-24">
        <div className="mx-auto grid max-w-[1400px] gap-12 px-4 py-24 sm:px-6 md:py-32 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:px-8">
          <div>
            <p className="eyebrow">Policies</p>
            <h2 id="policies-title" className="mt-3 text-3xl font-medium tracking-tight md:text-4xl">
              Cancellation &amp; changes
            </h2>
            <p className="mt-4 max-w-[40ch] text-sm leading-relaxed text-dim">Plain terms, counted from your departure date. Write to a planner if your situation doesn’t fit them.</p>
          </div>
          <dl className="divide-y divide-line border-y border-line">
            {POLICIES.map(([k, v]) => (
              <div key={k} className="grid gap-2 py-5 sm:grid-cols-[14rem_1fr] sm:gap-8">
                <dt className="font-mono text-sm text-fg">{k}</dt>
                <dd className="text-sm leading-relaxed text-dim">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="ab-credits mx-auto max-w-[1400px] px-4 pb-16 sm:px-6 lg:px-8">
          Imagery: Moon from the NASA Scientific Visualization Studio CGI Moon Kit; Earth from NASA Blue Marble Next Generation, Black Marble and Visible Earth
          (public domain). Satellite: Landsat 8 3D model, NASA 3D Resources (public domain), materials redone for the web. Kullu Valley:{" "}
          <a href="https://commons.wikimedia.org/wiki/File:Kullu_Valley_from_Rohtang_Pass,_India.jpg" rel="noopener noreferrer" target="_blank">
            “Kullu Valley from Rohtang Pass, India”
          </a>{" "}
          by Vyacheslav Argenberg,{" "}
          <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener noreferrer" target="_blank">
            CC BY 4.0
          </a>
          , cropped and colour-graded.
        </p>
      </section>
    </>
  );
}
