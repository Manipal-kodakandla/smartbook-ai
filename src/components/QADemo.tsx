import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Send, MessageCircle, FileText, Search } from "lucide-react";
import { useState } from "react";

const QADemo = () => {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([
    {
      type: "ai",
      content: "Hi! I'm ready to answer questions based on your uploaded notes. Try asking me something about photosynthesis!",
      sources: []
    }
  ]);
  const [isTyping, setIsTyping] = useState(false);

  const sampleQuestions = [
    "What is the main purpose of photosynthesis?",
    "Where do light-dependent reactions occur?",
    "What are the products of photosynthesis?",
    "How is photosynthesis like a solar panel?"
  ];

  const handleQuestionSubmit = (questionText?: string) => {
    const q = questionText || question;
    if (!q.trim()) return;

    // Add user message
    setMessages(prev => [...prev, { type: "user", content: q, sources: [] }]);
    setQuestion("");
    setIsTyping(true);

    // Simulate AI response
    setTimeout(() => {
      const responses = {
        "What is the main purpose of photosynthesis?": {
          content: "The main purpose of photosynthesis is to convert light energy into chemical energy (glucose) that plants can use for growth and survival. This process also produces oxygen as a byproduct, which is essential for most life on Earth.",
          sources: ["Biology Chapter 3: Photosynthesis - Page 1", "Notes on Plant Energy Systems"]
        },
        "Where do light-dependent reactions occur?": {
          content: "Light-dependent reactions occur in the thylakoids, which are membrane-bound structures inside the chloroplasts. These reactions require direct sunlight and are responsible for producing ATP and NADPH.",
          sources: ["Biology Chapter 3: Photosynthesis - Page 2"]
        },
        "What are the products of photosynthesis?": {
          content: "The main products of photosynthesis are glucose (C₆H₁₂O₆) and oxygen (O₂). Additionally, the process produces ATP and NADPH during the light-dependent reactions, which are used in the Calvin cycle.",
          sources: ["Biology Chapter 3: Photosynthesis - Page 1", "Chemistry Notes - Molecular Formulas"]
        },
        "How is photosynthesis like a solar panel?": {
          content: "Photosynthesis is like a solar panel because both convert light energy into usable energy. Solar panels convert sunlight into electricity, while plants convert sunlight into chemical energy (glucose). Both processes capture and transform light energy for practical use.",
          sources: ["Biology Chapter 3: Photosynthesis - Page 1"]
        }
      };

      const response = responses[q as keyof typeof responses] || {
        content: "I can answer questions based on your uploaded notes about photosynthesis. Please try one of the suggested questions or ask something more specific about the content you've uploaded.",
        sources: []
      };

      setMessages(prev => [...prev, { type: "ai", content: response.content, sources: response.sources }]);
      setIsTyping(false);
    }, 1500);
  };

  return (
    <section id="qa" className="py-20 bg-secondary/30">
      <div className="container mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold mb-4">Ask Questions Demo</h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Get instant answers from your notes. AI provides contextual responses with source attribution.
          </p>
        </div>

        <div className="max-w-4xl mx-auto grid lg:grid-cols-3 gap-8">
          {/* Chat Interface */}
          <div className="lg:col-span-2">
            <Card className="h-[600px] flex flex-col bg-gradient-card shadow-learning">
              {/* Header */}
              <div className="flex items-center gap-3 p-6 border-b border-border">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">SmartBook Q&A</h3>
                  <p className="text-sm text-muted-foreground">Ask anything about your notes</p>
                </div>
                <Badge variant="secondary" className="ml-auto bg-accent-soft text-accent">
                  2 Documents Loaded
                </Badge>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg p-4 ${
                        message.type === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      <p className="mb-2">{message.content}</p>
                      {message.sources.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs opacity-70 font-semibold">Sources:</p>
                          {message.sources.map((source, idx) => (
                            <div key={idx} className="flex items-center gap-1 text-xs opacity-70">
                              <FileText className="w-3 h-3" />
                              {source}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                
                {isTyping && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-lg p-4 flex items-center gap-2">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 bg-primary rounded-full animate-bounce" />
                        <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} />
                        <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
                      </div>
                      <span className="text-sm text-muted-foreground">AI is thinking...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="p-6 border-t border-border">
                <div className="flex gap-2">
                  <Input
                    placeholder="Ask a question about your notes..."
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleQuestionSubmit()}
                    className="flex-1"
                  />
                  <Button onClick={() => handleQuestionSubmit()} disabled={!question.trim()}>
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Sample Questions */}
            <Card className="p-6">
              <h4 className="font-semibold mb-4 flex items-center gap-2">
                <Search className="w-5 h-5 text-primary" />
                Try These Questions
              </h4>
              <div className="space-y-2">
                {sampleQuestions.map((q, index) => (
                  <Button
                    key={index}
                    variant="ghost"
                    className="w-full justify-start text-left h-auto p-3 text-sm"
                    onClick={() => handleQuestionSubmit(q)}
                  >
                    {q}
                  </Button>
                ))}
              </div>
            </Card>

            {/* Loaded Documents */}
            <Card className="p-6">
              <h4 className="font-semibold mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-accent" />
                Loaded Documents
              </h4>
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-accent-soft rounded-lg">
                  <FileText className="w-4 h-4 text-accent" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Biology Chapter 3</p>
                    <p className="text-xs text-muted-foreground">5 pages • Photosynthesis</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-accent-soft rounded-lg">
                  <FileText className="w-4 h-4 text-accent" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Chemistry Notes</p>
                    <p className="text-xs text-muted-foreground">3 pages • Molecular Formulas</p>
                  </div>
                </div>
              </div>
            </Card>

            {/* Features */}
            <Card className="p-6">
              <h4 className="font-semibold mb-4">Q&A Features</h4>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-accent rounded-full" />
                  <span>Instant responses (&lt;3s)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-accent rounded-full" />
                  <span>Source attribution</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-accent rounded-full" />
                  <span>Context-aware answers</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-accent rounded-full" />
                  <span>Only from your notes</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
};

export default QADemo;