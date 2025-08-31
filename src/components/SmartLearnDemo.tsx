import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Brain, ArrowRight, RotateCcw, BookOpen } from "lucide-react";
import { useState } from "react";

const SmartLearnDemo = () => {
  const [currentTopic, setCurrentTopic] = useState(0);
  const [showQuiz, setShowQuiz] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);

  const topics = [
    {
      title: "Photosynthesis Overview",
      content: "Photosynthesis is the process by which plants convert light energy into chemical energy. It occurs in the chloroplasts and involves two main stages: light-dependent reactions and the Calvin cycle.",
      example: "Think of photosynthesis like a solar panel that converts sunlight into usable energy, but instead of electricity, plants make glucose (sugar) to fuel their growth.",
      keywords: ["chloroplasts", "light energy", "chemical energy", "Calvin cycle"]
    },
    {
      title: "Light-Dependent Reactions",
      content: "These reactions occur in the thylakoids and require direct sunlight. Water molecules are split, oxygen is released, and energy carriers (ATP and NADPH) are produced.",
      example: "Like a water wheel powered by a stream - the flowing water (light) powers the wheel (chlorophyll) to produce energy.",
      keywords: ["thylakoids", "ATP", "NADPH", "oxygen"]
    }
  ];

  const quizQuestions = [
    {
      question: "Where does photosynthesis primarily occur in plant cells?",
      options: ["Mitochondria", "Chloroplasts", "Nucleus", "Cytoplasm"],
      correct: 1
    }
  ];

  const handleNextTopic = () => {
    if (currentTopic < topics.length - 1) {
      setCurrentTopic(currentTopic + 1);
      setShowQuiz(false);
      setSelectedAnswer(null);
      setShowResult(false);
    } else {
      setShowQuiz(true);
    }
  };

  const handleAnswerSelect = (index: number) => {
    setSelectedAnswer(index);
    setTimeout(() => {
      setShowResult(true);
    }, 500);
  };

  const progress = ((currentTopic + 1) / (topics.length + 1)) * 100;

  return (
    <section id="smartlearn" className="py-24">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-semibold mb-6">SmartLearn in Action</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            See how AI breaks down your notes into digestible topics with adaptive explanations and quizzes.
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          <Card className="p-10 bg-gradient-card shadow-learning">
            {/* Progress Header */}
            <div className="mb-10">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary/8 rounded-xl flex items-center justify-center">
                    <Brain className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium">Biology Chapter 3: Photosynthesis</h3>
                    <p className="text-sm text-muted-foreground">Topic {currentTopic + 1} of {topics.length + 1}</p>
                  </div>
                </div>
                <Badge variant="secondary" className="bg-accent-soft text-accent px-4 py-2">
                  SmartLearn Mode
                </Badge>
              </div>
              <Progress value={progress} className="w-full" />
            </div>

            {!showQuiz ? (
              /* Topic Content */
              <div className="space-y-8">
                <div>
                  <h4 className="text-xl font-medium mb-6 text-primary">{topics[currentTopic].title}</h4>
                  <p className="text-base leading-relaxed mb-8">{topics[currentTopic].content}</p>
                </div>

                {/* Real-world Example */}
                <Card className="p-6 bg-accent-soft border-accent/15">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-accent/15 rounded-xl flex items-center justify-center flex-shrink-0 mt-1">
                      <BookOpen className="w-5 h-5 text-accent" />
                    </div>
                    <div>
                      <h5 className="font-medium text-accent mb-3">Real-world Example</h5>
                      <p className="text-accent-foreground leading-relaxed">{topics[currentTopic].example}</p>
                    </div>
                  </div>
                </Card>

                {/* Keywords */}
                <div>
                  <h5 className="font-medium mb-4">Key Terms</h5>
                  <div className="flex flex-wrap gap-3">
                    {topics[currentTopic].keywords.map((keyword, index) => (
                      <Badge key={index} variant="outline" className="border-primary/25 text-primary px-3 py-1">
                        {keyword}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Navigation */}
                <div className="flex items-center justify-between pt-8">
                  <Button variant="ghost" className="gap-2">
                    <RotateCcw className="w-4 h-4" />
                    Review Previous
                  </Button>
                  <Button variant="learning" onClick={handleNextTopic} className="gap-2">
                    {currentTopic < topics.length - 1 ? "Next Topic" : "Take Quiz"}
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ) : (
              /* Quiz Section */
              <div className="space-y-6">
                <div className="text-center">
                  <h4 className="text-2xl font-bold mb-2 text-primary">Quick Knowledge Check</h4>
                  <p className="text-muted-foreground">Test your understanding of the topics you just learned</p>
                </div>

                <Card className="p-6">
                  <h5 className="text-lg font-semibold mb-4">{quizQuestions[0].question}</h5>
                  
                  <div className="space-y-3">
                    {quizQuestions[0].options.map((option, index) => (
                      <Button
                        key={index}
                        variant={
                          selectedAnswer === index
                            ? index === quizQuestions[0].correct
                              ? "success"
                              : "destructive"
                            : "outline"
                        }
                        className="w-full justify-start text-left h-auto p-4"
                        onClick={() => handleAnswerSelect(index)}
                        disabled={selectedAnswer !== null}
                      >
                        <span className="mr-3 font-semibold">{String.fromCharCode(65 + index)}.</span>
                        {option}
                        {showResult && index === quizQuestions[0].correct && (
                          <CheckCircle className="w-5 h-5 ml-auto text-accent" />
                        )}
                      </Button>
                    ))}
                  </div>

                  {showResult && (
                    <div className="mt-6 p-4 bg-accent-soft rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle className="w-5 h-5 text-accent" />
                        <span className="font-semibold text-accent">
                          {selectedAnswer === quizQuestions[0].correct ? "Correct!" : "Good try!"}
                        </span>
                      </div>
                      <p className="text-sm">
                        Photosynthesis occurs in chloroplasts, the specialized organelles in plant cells that contain chlorophyll.
                      </p>
                    </div>
                  )}
                </Card>

                {showResult && (
                  <div className="text-center">
                    <Button variant="learning" size="lg">
                      Continue Learning
                      <ArrowRight className="w-5 h-5" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </section>
  );
};

export default SmartLearnDemo;