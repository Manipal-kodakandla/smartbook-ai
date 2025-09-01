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
      
      <div className="container mx-auto px-6 py-24">
        <div className="grid lg:grid-cols-2 gap-16 items-center min-h-[600px]">
          {/* Left Content */}
          <div className="space-y-10 animate-slide-up">
            <div className="space-y-6">
              <h1 className="text-4xl lg:text-5xl font-semibold text-primary-foreground leading-relaxed">
                Transform Your
                <span className="bg-gradient-success bg-clip-text text-transparent"> Notes</span>
                <br />
                Into Smart Learning
              </h1>
              <p className="text-lg text-primary-foreground/75 max-w-lg leading-relaxed">
                Upload handwritten or typed notes and let AI create personalized study sessions with guided learning and instant Q&A.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-6">
              <Button 
                variant="success" 
                size="lg" 
                className="text-base px-10 py-3"
                onClick={() => document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth' })}
              >
                <Upload className="w-4 h-4" />
                Upload Notes
              </Button>
              <Button 
                variant="outline" 
                size="lg" 
                className="text-base px-10 py-3 bg-white/8 border-white/20 text-primary-foreground hover:bg-white/15"
                onClick={() => document.getElementById('smartlearn')?.scrollIntoView({ behavior: 'smooth' })}
              >
                Start SmartLearn
              </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-8 pt-12">
              <div className="text-center">
                <div className="text-2xl font-semibold text-accent">95%</div>
                <div className="text-sm text-primary-foreground/65">OCR Accuracy</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-accent">3s</div>
                <div className="text-sm text-primary-foreground/65">AI Response</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-semibold text-accent">75%</div>
                <div className="text-sm text-primary-foreground/65">Faster Learning</div>
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
      <div className="container mx-auto px-6 pb-24">
        <div className="grid md:grid-cols-3 gap-10">
          <Card className="p-8 bg-gradient-card shadow-card border-0 hover:shadow-learning transition-all duration-300 hover:-translate-y-1">
            <div className="space-y-5">
              <div className="w-14 h-14 bg-primary/8 rounded-xl flex items-center justify-center">
                <Upload className="w-7 h-7 text-primary" />
              </div>
              <h3 className="text-xl font-medium">Upload & Process</h3>
              <p className="text-muted-foreground leading-relaxed">
                Drag & drop PDFs, images, or documents. Our AI processes handwritten and typed notes with 95% accuracy.
              </p>
            </div>
          </Card>

          <Card 
            className="p-8 bg-gradient-card shadow-card border-0 hover:shadow-learning transition-all duration-300 hover:-translate-y-1 cursor-pointer"
            onClick={() => document.getElementById('smartlearn')?.scrollIntoView({ behavior: 'smooth' })}
          >
            <div className="space-y-5">
              <div className="w-14 h-14 bg-accent/8 rounded-xl flex items-center justify-center">
                <BookOpen className="w-7 h-7 text-accent" />
              </div>
              <h3 className="text-xl font-medium">SmartLearn Mode</h3>
              <p className="text-muted-foreground leading-relaxed">
                AI breaks down your notes into digestible topics with adaptive explanations and auto-generated quizzes.
              </p>
            </div>
          </Card>

          <Card 
            className="p-8 bg-gradient-card shadow-card border-0 hover:shadow-learning transition-all duration-300 hover:-translate-y-1 cursor-pointer"
            onClick={() => document.getElementById('qa')?.scrollIntoView({ behavior: 'smooth' })}
          >
            <div className="space-y-5">
              <div className="w-14 h-14 bg-learning-purple/8 rounded-xl flex items-center justify-center">
                <Brain className="w-7 h-7 text-learning-purple" />
              </div>
              <h3 className="text-xl font-medium">Ask Questions</h3>
              <p className="text-muted-foreground leading-relaxed">
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