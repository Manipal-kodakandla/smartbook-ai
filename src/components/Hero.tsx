import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BookOpen, Brain, Zap, Upload } from "lucide-react";
import heroImage from "@/assets/hero-learning.jpg";

const Hero = () => {
  return (
    <section className="relative min-h-screen bg-gradient-hero overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary-glow))_0%,transparent_50%)] opacity-20" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,hsl(var(--accent))_0%,transparent_50%)] opacity-10" />
      
      <div className="container mx-auto px-6 py-20">
        <div className="grid lg:grid-cols-2 gap-12 items-center min-h-[600px]">
          {/* Left Content */}
          <div className="space-y-8 animate-slide-up">
            <div className="space-y-4">
              <h1 className="text-5xl lg:text-6xl font-bold text-primary-foreground leading-tight">
                Transform Your
                <span className="bg-gradient-success bg-clip-text text-transparent"> Notes</span>
                <br />
                Into Smart Learning
              </h1>
              <p className="text-xl text-primary-foreground/80 max-w-lg leading-relaxed">
                Upload handwritten or typed notes and let AI create personalized study sessions with guided learning and instant Q&A.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <Button variant="success" size="lg" className="text-lg px-8 py-4">
                <Upload className="w-5 h-5" />
                Upload Notes
              </Button>
              <Button variant="outline" size="lg" className="text-lg px-8 py-4 bg-white/10 border-white/30 text-primary-foreground hover:bg-white/20">
                See Demo
              </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-6 pt-8">
              <div className="text-center">
                <div className="text-3xl font-bold text-accent">95%</div>
                <div className="text-sm text-primary-foreground/70">OCR Accuracy</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-accent">3s</div>
                <div className="text-sm text-primary-foreground/70">AI Response</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-accent">75%</div>
                <div className="text-sm text-primary-foreground/70">Faster Learning</div>
              </div>
            </div>
          </div>

          {/* Right Content - Hero Image */}
          <div className="relative">
            <div className="relative z-10">
              <img 
                src={heroImage} 
                alt="SmartBook AI Learning Platform" 
                className="rounded-2xl shadow-learning w-full animate-float"
              />
              
              {/* Floating Cards */}
              <Card className="absolute -top-4 -left-4 p-4 bg-gradient-card shadow-card animate-float" style={{ animationDelay: "0.5s" }}>
                <div className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-primary" />
                  <span className="text-sm font-medium">AI Analysis</span>
                </div>
              </Card>
              
              <Card className="absolute -bottom-4 -right-4 p-4 bg-gradient-card shadow-card animate-float" style={{ animationDelay: "1s" }}>
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-accent" />
                  <span className="text-sm font-medium">Smart Learning</span>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>

      {/* Features Preview */}
      <div className="container mx-auto px-6 pb-20">
        <div className="grid md:grid-cols-3 gap-8">
          <Card className="p-6 bg-gradient-card shadow-card border-0 hover:shadow-learning transition-all duration-300 hover:-translate-y-2">
            <div className="space-y-4">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <Upload className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold">Upload & Process</h3>
              <p className="text-muted-foreground">
                Drag & drop PDFs, images, or documents. Our AI processes handwritten and typed notes with 95% accuracy.
              </p>
            </div>
          </Card>

          <Card className="p-6 bg-gradient-card shadow-card border-0 hover:shadow-learning transition-all duration-300 hover:-translate-y-2">
            <div className="space-y-4">
              <div className="w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center">
                <BookOpen className="w-6 h-6 text-accent" />
              </div>
              <h3 className="text-xl font-semibold">SmartLearn Mode</h3>
              <p className="text-muted-foreground">
                AI breaks down your notes into digestible topics with adaptive explanations and auto-generated quizzes.
              </p>
            </div>
          </Card>

          <Card className="p-6 bg-gradient-card shadow-card border-0 hover:shadow-learning transition-all duration-300 hover:-translate-y-2">
            <div className="space-y-4">
              <div className="w-12 h-12 bg-learning-purple/10 rounded-lg flex items-center justify-center">
                <Brain className="w-6 h-6 text-learning-purple" />
              </div>
              <h3 className="text-xl font-semibold">Ask Questions</h3>
              <p className="text-muted-foreground">
                Get instant answers from your notes. AI provides contextual responses with source attribution.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
};

export default Hero;