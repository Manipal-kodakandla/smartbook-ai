import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Brain, ArrowRight, RotateCcw, BookOpen, Trophy } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { documentService, type Document, type Topic, type Quiz } from "@/services/documentService";

const SmartLearnDemo = ({ selectedDocument }: { selectedDocument?: Document }) => {
  const [currentTopic, setCurrentTopic] = useState(0);
  const [showQuiz, setShowQuiz] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [currentQuiz, setCurrentQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [correctAnswers, setCorrectAnswers] = useState(0);
  const [totalQuizzes, setTotalQuizzes] = useState(0);
  const { user } = useAuth();

  // Load topics when document is selected and poll for processing completion
  useEffect(() => {
    if (selectedDocument) {
      console.log('🔄 SmartLearnDemo: Document selected:', {
        id: selectedDocument.id,
        title: selectedDocument.title,
        status: selectedDocument.processing_status
      });
      
      if (selectedDocument.processing_status === 'completed') {
        console.log('✅ Document already completed, loading topics immediately...');
        loadTopics(selectedDocument.id);
      } else {
        // Poll for processing completion
        console.log('📄 Document not completed yet, starting polling. Status:', selectedDocument.processing_status);
        const pollInterval = setInterval(async () => {
          try {
            console.log('🔄 Polling for document processing completion...');
            const updatedDocs = await documentService.getUserDocuments(user?.id || '');
            const updatedDoc = updatedDocs.find(doc => doc.id === selectedDocument.id);
            console.log('📊 Polling result - Updated document:', {
              found: !!updatedDoc,
              status: updatedDoc?.processing_status,
              id: updatedDoc?.id
            });
            if (updatedDoc?.processing_status === 'completed') {
              console.log('✅ Document processing completed, loading topics...');
              clearInterval(pollInterval);
              loadTopics(selectedDocument.id);
            } else if (updatedDoc?.processing_status === 'failed') {
              console.log('❌ Document processing failed');
              clearInterval(pollInterval);
            }
          } catch (error) {
            console.error('Error polling document status:', error);
          }
        }, 2000); // Poll every 2 seconds

        return () => clearInterval(pollInterval);
      }
    } else {
      console.log('⚠️ No document selected in SmartLearnDemo');
    }
  }, [selectedDocument, user?.id]);

  const loadTopics = async (documentId: string) => {
    try {
      console.log('📚 Loading topics for document:', documentId);
      setLoading(true);
      const documentTopics = await documentService.getDocumentTopics(documentId);
      console.log('📋 Topics loaded in component:', documentTopics.length, 'topics');
      setTopics(documentTopics);
      setCurrentTopic(0);
      setShowQuiz(false);
      setSelectedAnswer(null);
      setShowResult(false);
      setIsCompleted(false);
      setQuizCompleted(false);
      setCorrectAnswers(0);
      setTotalQuizzes(0);
    } catch (error) {
      console.error('❌ Failed to load topics:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadQuizForCurrentTopic = async () => {
    if (topics[currentTopic]) {
      try {
        const quizzes = await documentService.getTopicQuizzes(topics[currentTopic].id);
        if (quizzes.length > 0) {
          setCurrentQuiz(quizzes[0]);
        }
      } catch (error) {
        console.error('Failed to load quiz:', error);
      }
    }
  };

  const handleStartQuiz = () => {
    setShowQuiz(true);
    loadQuizForCurrentTopic();
  };

  const handleNextTopic = () => {
    if (currentTopic < topics.length - 1) {
      setCurrentTopic(currentTopic + 1);
      setShowQuiz(false);
      setSelectedAnswer(null);
      setShowResult(false);
      setCurrentQuiz(null);
      setQuizCompleted(false);
    } else {
      // All topics completed
      setIsCompleted(true);
    }
  };

  const handleAutoAdvanceAfterQuiz = () => {
    setTotalQuizzes(prev => prev + 1);
    setQuizCompleted(true);
    
    // Auto advance after 2 seconds
    setTimeout(() => {
      if (currentTopic < topics.length - 1) {
        handleNextTopic();
      } else {
        setIsCompleted(true);
      }
    }, 2000);
  };

  const handleAnswerSelect = async (index: number) => {
    setSelectedAnswer(index);
    
    // Update user progress
    if (user && topics[currentTopic] && currentQuiz) {
      try {
        const isCorrect = index === currentQuiz.correct_answer;
        if (isCorrect) {
          setCorrectAnswers(prev => prev + 1);
        }
        
        await documentService.updateUserProgress(user.id, topics[currentTopic].id, {
          completed: true,
          quiz_score: isCorrect ? 100 : 0,
          quiz_attempts: 1
        });
      } catch (error) {
        console.error('Failed to update progress:', error);
      }
    }
    
    setTimeout(() => {
      setShowResult(true);
      // Auto advance after showing result
      setTimeout(() => {
        handleAutoAdvanceAfterQuiz();
      }, 3000);
    }, 500);
  };

  const progress = topics.length > 0 ? ((currentTopic + 1) / topics.length) * 100 : 0;

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
            {loading ? (
              <div className="text-center py-12">
                <div className="w-12 h-12 bg-primary/8 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <Brain className="w-6 h-6 text-primary animate-pulse" />
                </div>
                <p className="text-muted-foreground">Loading topics...</p>
              </div>
            ) : !selectedDocument ? (
              <div className="text-center py-12">
                <div className="w-12 h-12 bg-primary/8 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <Brain className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-medium mb-2">No Document Selected</h3>
                <p className="text-muted-foreground">Upload a document to start learning with AI-generated topics and quizzes.</p>
              </div>
            ) : selectedDocument.processing_status !== 'completed' ? (
              <div className="text-center py-12">
                <div className="w-12 h-12 bg-primary/8 rounded-xl flex items-center justify-center mx-auto mb-4 animate-pulse">
                  <Brain className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-medium mb-2">Processing Document</h3>
                <p className="text-muted-foreground">AI is analyzing your document and generating topics. This may take a few moments...</p>
              </div>
            ) : topics.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-12 h-12 bg-primary/8 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <Brain className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-medium mb-2">No Topics Found</h3>
                <p className="text-muted-foreground mb-4">
                  Topics may still be loading. Check the console for details.
                </p>
                <Button 
                  variant="outline" 
                  onClick={() => loadTopics(selectedDocument.id)}
                  className="gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Refresh Topics
                </Button>
              </div>
            ) : (
              <>
                {/* Progress Header */}
                <div className="mb-10">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-primary/8 rounded-xl flex items-center justify-center">
                        <Brain className="w-6 h-6 text-primary" />
                      </div>
                      <div>
                        <h3 className="text-lg font-medium">{selectedDocument?.title || 'Learning Content'}</h3>
                        <p className="text-sm text-muted-foreground">Topic {currentTopic + 1} of {topics.length}</p>
                      </div>
                    </div>
                    <Badge variant="secondary" className="bg-accent-soft text-accent px-4 py-2">
                      SmartLearn Mode
                    </Badge>
                  </div>
                  <Progress value={progress} className="w-full" />
                </div>

                {isCompleted ? (
                  /* Completion Screen with Summary */
                  <div className="text-center space-y-8">
                    <div className="w-20 h-20 bg-accent/15 rounded-2xl flex items-center justify-center mx-auto">
                      <Trophy className="w-10 h-10 text-accent" />
                    </div>
                    <div>
                      <h4 className="text-2xl font-bold mb-4 text-accent">🎉 Learning Complete!</h4>
                      <p className="text-lg text-muted-foreground mb-8">
                        You've successfully completed all {topics.length} topics from "{selectedDocument?.title}".
                      </p>
                    </div>
                    
                    {/* Learning Summary */}
                    <Card className="p-6 bg-accent-soft border-accent/15 max-w-md mx-auto">
                      <h5 className="font-semibold text-accent mb-4">📊 Learning Summary</h5>
                      <div className="space-y-3 text-sm">
                        <div className="flex justify-between">
                          <span>Topics Covered:</span>
                          <span className="font-medium">{topics.length}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Quiz Score:</span>
                          <span className="font-medium text-accent">
                            {totalQuizzes > 0 ? `${correctAnswers}/${totalQuizzes} (${Math.round((correctAnswers/totalQuizzes)*100)}%)` : 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Strength:</span>
                          <span className="font-medium">
                            {correctAnswers/totalQuizzes >= 0.8 ? 'Excellent' : correctAnswers/totalQuizzes >= 0.6 ? 'Good' : 'Needs Review'}
                          </span>
                        </div>
                      </div>
                    </Card>
                    
                    <div className="flex gap-4 justify-center">
                      <Button variant="outline" onClick={() => {
                        setCurrentTopic(0);
                        setIsCompleted(false);
                        setShowQuiz(false);
                        setSelectedAnswer(null);
                        setShowResult(false);
                        setQuizCompleted(false);
                        setCorrectAnswers(0);
                        setTotalQuizzes(0);
                      }}>
                        Review Topics
                      </Button>
                      <Button variant="learning" onClick={() => document.getElementById('qa')?.scrollIntoView({ behavior: 'smooth' })}>
                        Ask Questions
                      </Button>
                    </div>
                  </div>
                ) : !showQuiz ? (
                  /* Topic Content */
                  <div className="space-y-8">
                    <div>
                      <h4 className="text-xl font-medium mb-6 text-primary">{topics[currentTopic]?.title}</h4>
                      <p className="text-base leading-relaxed mb-8">{topics[currentTopic]?.content}</p>
                    </div>

                    {/* Real-world Example */}
                    {topics[currentTopic]?.real_world_example && (
                      <Card className="p-6 bg-accent-soft border-accent/15">
                        <div className="flex items-start gap-4">
                          <div className="w-10 h-10 bg-accent/15 rounded-xl flex items-center justify-center flex-shrink-0 mt-1">
                            <BookOpen className="w-5 h-5 text-accent" />
                          </div>
                          <div>
                            <h5 className="font-medium text-accent mb-3">Real-world Example</h5>
                            <p className="text-accent-foreground leading-relaxed">{topics[currentTopic]?.real_world_example}</p>
                          </div>
                        </div>
                      </Card>
                    )}

                    {/* Keywords */}
                    {topics[currentTopic]?.keywords && topics[currentTopic].keywords.length > 0 && (
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
                    )}

                    {/* Navigation - Auto-guided flow */}
                    <div className="flex items-center justify-between pt-8">
                      <Button 
                        variant="ghost" 
                        className="gap-2"
                        onClick={() => setCurrentTopic(Math.max(0, currentTopic - 1))}
                        disabled={currentTopic === 0}
                      >
                        <RotateCcw className="w-4 h-4" />
                        Review Previous
                      </Button>
                      <div className="flex gap-3">
                        <Button variant="learning" onClick={handleStartQuiz} className="gap-2">
                          Take Quiz
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Quiz Section */
                  <div className="space-y-6">
                    <div className="text-center">
                      <h4 className="text-2xl font-bold mb-2 text-primary">Quick Knowledge Check</h4>
                      <p className="text-muted-foreground">Test your understanding of the topics you just learned</p>
                    </div>

                    {currentQuiz ? (
                      <Card className="p-6">
                        <h5 className="text-lg font-semibold mb-4">{currentQuiz.question}</h5>
                        
                        <div className="space-y-3">
                          {currentQuiz.options.map((option, index) => (
                            <Button
                              key={index}
                              variant={
                                selectedAnswer === index
                                  ? index === currentQuiz.correct_answer
                                    ? "default"
                                    : "destructive"
                                  : "outline"
                              }
                              className="w-full justify-start text-left h-auto p-4"
                              onClick={() => handleAnswerSelect(index)}
                              disabled={selectedAnswer !== null}
                            >
                              <span className="mr-3 font-semibold">{String.fromCharCode(65 + index)}.</span>
                              {option}
                              {showResult && index === currentQuiz.correct_answer && (
                                <CheckCircle className="w-5 h-5 ml-auto text-accent" />
                              )}
                            </Button>
                          ))}
                        </div>

                        {showResult && currentQuiz.explanation && (
                          <div className="mt-6 p-4 bg-accent-soft rounded-lg">
                            <div className="flex items-center gap-2 mb-2">
                              <CheckCircle className="w-5 h-5 text-accent" />
                              <span className="font-semibold text-accent">
                                {selectedAnswer === currentQuiz.correct_answer ? "Correct!" : "Good try!"}
                              </span>
                            </div>
                            <p className="text-sm">{currentQuiz.explanation}</p>
                          </div>
                        )}
                      </Card>
                    ) : (
                      <div className="text-center py-8">
                        <p className="text-muted-foreground">Loading quiz...</p>
                      </div>
                    )}

                    {showResult && (
                      <div className="text-center space-y-4">
                        <div className="p-4 bg-primary/5 rounded-lg">
                          <p className="text-sm text-muted-foreground">
                            {quizCompleted 
                              ? currentTopic >= topics.length - 1 
                                ? "🎉 All topics completed! Generating your summary..."
                                : "✅ Moving to next topic automatically..."
                              : currentTopic >= topics.length - 1 
                                ? "Complete Learning" 
                                : "Continue Learning"
                            }
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </section>
  );
};

export default SmartLearnDemo;