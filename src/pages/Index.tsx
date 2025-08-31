import Navigation from "@/components/Navigation";
import Hero from "@/components/Hero";
import UploadSection from "@/components/UploadSection";
import SmartLearnDemo from "@/components/SmartLearnDemo";
import QADemo from "@/components/QADemo";

const Index = () => {
  return (
    <div className="min-h-screen">
      <Navigation />
      <main>
        <Hero />
        <UploadSection />
        <SmartLearnDemo />
        <QADemo />
      </main>
    </div>
  );
};

export default Index;
