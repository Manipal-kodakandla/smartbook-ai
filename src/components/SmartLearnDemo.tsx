import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Brain, ArrowRight, RotateCcw, BookOpen, Trophy, AlertCircle, Clock, RefreshCw } from "lucide-react";
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
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [pollAttempts, setPollAttempts] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const { user } = useAuth();

  // Enhanced polling with better error handling
  useEffect(() => {
    if (selectedDocument) {
      console.log('🔄 SmartLearnDemo: Document selected:', {
        id: selectedDocument.id,
        title: selectedDocument.title,
        status: selectedDocument.processing_status
      });
      
      setError('');
      setPollAttempts(0);
      setRetryCount(0);
      setProcessingStatus(selectedDocument.processing_status);
      
      if (selectedDocument.processing_status === 'completed') {
        console.log('✅ Document already completed, loading topics immediately...');
        loadTopics(selectedDocument.id);
      } else if (selectedDocument.processing_status === 'failed') {
        setError('Document processing failed. The system encountered an error while analyzing your document.');
      } else {
        // Enhanced polling with timeout and better error handling
        console.log('📄 Document processing in progress, starting enhanced polling. Status:', selectedDocument.processing_status);
        startEnhancedPolling(selectedDocument.id);
      }
    } else {
      console.log('⚠️ No document selected in SmartLearnDemo');
      resetState();
    }
  }, [selectedDocument, user?.id]);

  const resetState = () => {
    setTopics([]);
    setCurrentTopic(0);
    setShowQuiz(false);
    setSelectedAnswer(null);
    setShowResult(false);
    setIsCompleted(false);
    setQuizCompleted(false);
    setCorrectAnswers(0);
    setTotalQuizzes(0);
    setError('');
    setProcessingStatus('');
    setPollAttempts(0);
    setRetryCount(0);
  };

  const startEnhancedPolling = (documentId: string) => {
    const maxPollAttempts = 30; // 1 minute total (2s intervals)
    const pollInterval = setInterval(async () => {
      try {
        setPollAttempts(prev => prev + 1);
        console.log(`🔄 Polling attempt ${pollAttempts + 1}/${maxPollAttempts} for document processing...`);
        
        const updatedDocs = await documentService.getUserDocuments(user?.id || '');
        const updatedDoc = updatedDocs.find(doc => doc.id === documentId);
        
        console.log('📊 Polling result:', {
          found: !!updatedDoc,
          status: updatedDoc?.processing_status,
          attempt: pollAttempts + 1
        });

        if (updatedDoc) {
          setProcessingStatus(updatedDoc.processing_status);
          
          if (updatedDoc.processing_status === 'completed') {
            console.log('✅ Document processing completed successfully');
            clearInterval(pollInterval);
            loadTopics(documentId);
          } else if (updatedDoc.processing_status === 'failed') {
            console.log('❌ Document processing failed');
            clearInterval(pollInterval);
            setError('Document processing failed. The AI system encountered an error while analyzing your content.');
          } else if (pollAttempts >= maxPollAttempts) {
            console.log('⏰ Polling timeout reached');
            clearInterval(pollInterval);
            setError('Processing is taking longer than expected. The document may still complete in the background.');
          }
        } else if (pollAttempts >= maxPollAttempts) {
          clearInterval(pollInterval);
          setError('Unable to track document processing status. Please try refreshing.');
        }
      } catch (error) {
        console.error('❌ Polling error:', error);
        if (pollAttempts >= maxPollAttempts) {
          clearInterval(pollInterval);
          setError('Network error while checking processing status. Please try again.');
        }
      }
    }, 2000);

    // Cleanup function
    return () => clearInterval(pollInterval);
  };

  const loadTopics = async (documentId: string) => {
    try {
      console.log('📚 Loading topics for document:', documentId);
      setLoading(true);
      setError('');
      
      const documentTopics = await documentService.getDocumentTopics(documentId);
      console.log('📋 Topics loaded in component:', documentTopics.length, 'topics');
      
      if (documentTopics.length === 0) {
        // Give topics a moment to appear after processing completes
        console.log('⏳ No topics found, waiting a moment for database sync...');
        setTimeout(async () => {
          const retryTopics = await documentService.getDocumentTopics(documentId);
          if (retryTopics.length === 0) {
            setError('No topics were generated from this document. This may happen with very short documents or documents with unclear content.');
          } else {
            setTopics(retryTopics);
            resetLearningState();
          }
        }, 3000);
      } else {
        setTopics(documentTopics);
        resetLearningState();
      }
    } catch (error) {
      console.error('❌ Failed to load topics:', error);
      setError('Failed to load learning topics. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const resetLearningState = () => {
    setCurrentTopic(0);
    setShowQuiz(false);
    setSelectedAnswer(null);
    setShowResult(false);
    setIsCompleted(false);
    setQuizCompleted(false);
    setCorrectAnswers(0);
    setTotalQuizzes(0);
  };

  const loadQuizForCurrentTopic = async () => {
    if (topics[currentTopic]) {
      try {
        setLoading(true);
        const quizzes = await documentService.getTopicQuizzes(topics[currentTopic].id);
        if (quizzes.length > 0) {
          setCurrentQuiz(quizzes[0]);
        } else {
          // Generate quiz if none exists - this could call a quiz generation endpoint
          console.log('⚠️ No quiz found for topic, may need to generate one');
          setCurrentQuiz(null);
        }
      } catch (error) {
        console.error('❌ Failed to load quiz:', error);
        setCurrentQuiz(null);
      } finally {
        setLoading(false);
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
      setIsCompleted(true);
    }
  };

  const handleAutoAdvanceAfterQuiz = () => {
    setTotalQuizzes(prev => prev + 1);
    setQuizCompleted(true);
    
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
        console.error('❌ Failed to update progress:', error);
      }
    }
    
    setTimeout(() => {
      setShowResult(true);
      setTimeout(() => {
        handleAutoAdvanceAfterQuiz();
      }, 3000);
    }, 500);
  };

  const handleRetry = () => {
    if (selectedDocument) {
      setRetryCount(prev => prev + 1);
      setError('');
      if (selectedDocument.processing_status === 'completed') {
        loadTopics(selectedDocument.id);
      } else {
        startEnhancedPolling(selectedDocument.id);
      }
    }
  };

  const progress = topics.length > 0 ? ((currentTopic + 1) / topics.length) * 100 : 0;

  const renderProcessingStatus = () => {
    const statusMessages = {
      'processing': 'AI is analyzing your document and generating learning topics...',
      'failed': 'Document processing failed. Please try uploading again.',
      'pending': 'Document is queued for processing...',
      '': 'Processing your document...'
    };

    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 bg-primary/8 rounded-xl flex items-center justify-center mx-auto mb-4">
          {processingStatus === 'processing' ? (
            <RefreshCw className="w-6 h-6 text-primary animate-spin" />
          ) : (
            <Clock className="w-6 h-6 text-primary" />
          )}
        </div>
        <h3 className="text-lg font-medium mb-2">Processing Document</h3>
        <p className="text-muted-foreground mb-4">
          {statusMessages[processingStatus] || statusMessages['']}
        </p>
        <div className="text-xs text-muted-foreground">
          Status: {processingStatus || 'processing'} • Attempt: {pollAttempts}/30
        </div>
      </div>
    );
  };

  const renderError = () => (
    <div className="text-center py-12">
      <div className="w-12 h-12 bg-destructive/8 rounded-xl flex items-center justify-center mx-auto mb-4">
        <AlertCircle className="w-6 h-6 text-destructive" />
      </div>
      <h3 className="text-lg font-medium mb-2">Something Went Wrong</h3>
      <p className="text-muted-foreground mb-6 max-w-md mx-auto">
        {error}
      </p>
      <div className="flex gap-2 justify-center">
        <Button variant="outline" onClick={handleRetry} className="gap-2">
          <RotateCcw className="w-4 h-4" />
          Retry {retryCount > 0 && `(${retryCount})`}
        </Button>
        <Button variant="ghost" onClick={() => document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth' })}>
          Upload New Document
        </Button>
      </div>
    </div>
  );

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
            {error ? (
              renderError()
            ) : loading ? (
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
                <p className="text-muted-foreground mb-6">Upload a document to start learning with AI-generated topics and quizzes.</p>
                <Button 
                  variant="learning" 
                  onClick={() => document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth' })}
                  className="gap-2"
                >
                  <Brain className="w-4 h-4" />
                  Upload Document
                </Button>
              </div>
            ) : selectedDocument.processing_status !== 'completed' ? (
              renderProcessingStatus()
            ) : topics.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-12 h-12 bg-primary/8 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <Brain className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-medium mb-2">Generating Learning Topics</h3>
                <p className="text-muted-foreground mb-4">
                  AI has processed your document but topics are still being generated. This should complete shortly.
                </p>
                <Button 
                  variant="outline" 
                  onClick={() => loadTopics(selectedDocument.id)}
                  className="gap-2"
                  disabled={loading}
                >
                  {loading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <RotateCcw className="w-4 h-4" />
                  )}
                  Check Again
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
                  /* Completion Screen with Enhanced Summary */
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
                    
                    {/* Enhanced Learning Summary */}
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
                          <span>Performance:</span>
                          <span className="font-medium">
                            {totalQuizzes === 0 ? 'No quizzes taken' :
                             correctAnswers/totalQuizzes >= 0.8 ? '🌟 Excellent' : 
                             correctAnswers/totalQuizzes >= 0.6 ? '✅ Good' : 
                             '📚 Needs Review'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Time Investment:</span>
                          <span className="font-medium">~{topics.length * 2} minutes</span>
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
                        <RotateCcw className="w-4 h-4 mr-2" />
                        Review Topics
                      </Button>
                      <Button variant="learning" onClick={() => document.getElementById('qa')?.scrollIntoView({ behavior: 'smooth' })}>
                        <Brain className="w-4 h-4 mr-2" />
                        Ask Questions
                      </Button>
                    </div>
                  </div>
                ) : !showQuiz ? (
                  /* Enhanced Topic Content */
                  <div className="space-y-8">
                    <div>
                      <h4 className="text-xl font-medium mb-6 text-primary">{topics[currentTopic]?.title}</h4>
                      
                      {/* Main Content */}
                      <div className="prose prose-lg max-w-none mb-8">
                        <p className="text-base leading-relaxed">{topics[currentTopic]?.content}</p>
                      </div>

                      {/* Simplified Explanation */}
                      {topics[currentTopic]?.simplified_explanation && (
                        <Card className="p-6 bg-primary/5 border-primary/15 mb-6">
                          <div className="flex items-start gap-4">
                            <div className="w-10 h-10 bg-primary/15 rounded-xl flex items-center justify-center flex-shrink-0 mt-1">
                              <Brain className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                              <h5 className="font-medium text-primary mb-3">Simplified Explanation</h5>
                              <p className="text-primary-foreground leading-relaxed">{topics[currentTopic]?.simplified_explanation}</p>
                            </div>
                          </div>
                        </Card>
                      )}
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

                    {/* Enhanced Navigation */}
                    <div className="flex items-center justify-between pt-8 border-t">
                      <Button 
                        variant="ghost" 
                        className="gap-2"
                        onClick={() => setCurrentTopic(Math.max(0, currentTopic - 1))}
                        disabled={currentTopic === 0}
                      >
                        <RotateCcw className="w-4 h-4" />
                        Previous Topic
                      </Button>
                      
                      <div className="flex gap-3">
                        <Button 
                          variant="outline" 
                          onClick={handleNextTopic}
                          disabled={currentTopic >= topics.length - 1}
                        >
                          Skip Quiz
                        </Button>
                        <Button variant="learning" onClick={handleStartQuiz} className="gap-2">
                          Take Quiz
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Enhanced Quiz Section */
                  <div className="space-y-6">
                    <div className="text-center">
                      <h4 className="text-2xl font-bold mb-2 text-primary">Knowledge Check</h4>
                      <p className="text-muted-foreground">Test your understanding of: "{topics[currentTopic]?.title}"</p>
                    </div>

                    {currentQuiz ? (
                      <Card className="p-6">
                        <h5 className="text-lg font-semibold mb-6">{currentQuiz.question}</h5>
                        
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
                              className="w-full justify-start text-left h-auto p-4 transition-all"
                              onClick={() => handleAnswerSelect(index)}
                              disabled={selectedAnswer !== null}
                            >
                              <span className="mr-3 font-semibold text-sm bg-muted rounded px-2 py-1">
                                {String.fromCharCode(65 + index)}
                              </span>
                              <span className="flex-1">{option}</span>
                              {showResult && index === currentQuiz.correct_answer && (
                                <CheckCircle className="w-5 h-5 ml-2 text-accent" />
                              )}
                            </Button>
                          ))}
                        </div>

                        {showResult && (
                          <div className={`mt-6 p-4 rounded-lg ${
                            selectedAnswer === currentQuiz.correct_answer 
                              ? 'bg-accent-soft border border-accent/20' 
                              : 'bg-orange-50 border border-orange-200'
                          }`}>
                            <div className="flex items-center gap-2 mb-2">
                              <CheckCircle className={`w-5 h-5 ${
                                selectedAnswer === currentQuiz.correct_answer 
                                  ? 'text-accent' 
                                  : 'text-orange-600'
                              }`} />
                              <span className={`font-semibold ${
                                selectedAnswer === currentQuiz.correct_answer 
                                  ? 'text-accent' 
                                  : 'text-orange-600'
                              }`}>
                                {selectedAnswer === currentQuiz.correct_answer ? "🎉 Excellent!" : "💡 Good effort!"}
                              </span>
                            </div>
                            {currentQuiz.explanation && (
                              <p className="text-sm text-muted-foreground">{currentQuiz.explanation}</p>
                            )}
                          </div>
                        )}
                      </Card>
                    ) : (
                      <Card className="p-8">
                        <div className="text-center space-y-4">
                          <div className="w-12 h-12 bg-muted/50 rounded-xl flex items-center justify-center mx-auto">
                            <Brain className="w-6 h-6 text-muted-foreground" />
                          </div>
                          <div>
                            <h5 className="font-medium mb-2">Quiz Coming Soon</h5>
                            <p className="text-sm text-muted-foreground">
                              Quizzes for this topic are being generated. You can continue learning for now.
                            </p>
                          </div>
                          <Button variant="outline" onClick={handleNextTopic} className="gap-2">
                            Continue Learning
                            <ArrowRight className="w-4 h-4" />
                          </Button>
                        </div>
                      </Card>
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
                                ? "Completing learning session..." 
                                : "Continuing to next topic..."
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
