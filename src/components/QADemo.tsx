import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Send, MessageCircle, FileText, Search } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { documentService, type Document } from "@/services/documentService";

const QADemo = ({ userDocuments }: { userDocuments?: Document[] }) => {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([
    {
      type: "ai",
      content: "Hi! I'm ready to answer questions based on your uploaded notes.",
      sources: []
    }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const { user } = useAuth();

  const sampleQuestions = [
    "What is the main purpose of photosynthesis?",
    "Where do light-dependent reactions occur?",
    "What are the products of photosynthesis?",
    "How is photosynthesis like a solar panel?"
  ];

  const handleQuestionSubmit = async (questionText?: string) => {
    const q = questionText || question;
    if (!q.trim() || !user) return;

    // Add user message
    setMessages(prev => [...prev, { type: "user", content: q, sources: [] }]);
    setQuestion("");
    setIsTyping(true);

    try {
      const response = await documentService.askQuestion(q, user.id);
      setMessages(prev => [...prev, { 
        type: "ai", 
        content: response.answer, 
        sources: response.sources 
      }]);
    } catch (error) {
      console.error('Failed to get answer:', error);
      setMessages(prev => [...prev, { 
        type: "ai", 
        content: "I'm sorry, I encountered an error while processing your question. Please try again.", 
        sources: [] 
      }]);
    } finally {
      setIsTyping(false);
    }
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
                  {userDocuments?.length || 0} Documents Loaded
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
                {userDocuments && userDocuments.length > 0 ? (
                  userDocuments.map((doc, index) => (
                    <div key={index} className="flex items-center gap-3 p-3 bg-accent-soft rounded-lg">
                      <FileText className="w-4 h-4 text-accent" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{doc.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {doc.file_type} • {doc.processing_status}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No documents uploaded yet</p>
                )}
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