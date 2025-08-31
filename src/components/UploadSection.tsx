import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, Image, CheckCircle, ArrowRight } from "lucide-react";
import { useState, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { documentService, type Document } from "@/services/documentService";
import { toast } from "@/hooks/use-toast";

const UploadSection = ({ onDocumentUploaded }: { onDocumentUploaded?: (document: Document) => void }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<Document[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user, signInAnonymously } = useAuth();

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!user) {
      // Sign in anonymously for demo purposes
      try {
        await signInAnonymously();
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to authenticate. Please try again.",
          variant: "destructive",
        });
        return;
      }
    }

    // Validate file type
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'text/plain'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Unsupported file type",
        description: "Please upload PDF, DOCX, JPG, PNG, or TXT files.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setUploadProgress(0);

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 15;
        });
      }, 300);

      const document = await documentService.uploadDocument(file, user!.id);
      
      clearInterval(progressInterval);
      setUploadProgress(100);
      
      setTimeout(() => {
        setUploadedFiles(prev => [...prev, document]);
        setIsProcessing(false);
        setUploadProgress(0);
        onDocumentUploaded?.(document);
        
        toast({
          title: "Upload successful!",
          description: "Your document has been processed and is ready for learning.",
        });
      }, 500);

    } catch (error) {
      setIsProcessing(false);
      setUploadProgress(0);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload document",
        variant: "destructive",
      });
    }
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  return (
    <section id="upload" className="py-24 bg-secondary/20">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-semibold mb-6">Upload Your Notes</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Support for handwritten notes, PDFs, images, and documents. Our AI processes everything with precision.
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          <Card 
            className={`p-12 border-2 border-dashed transition-all duration-300 ${
              isDragOver 
                ? 'border-primary bg-primary/3 shadow-glow' 
                : 'border-border hover:border-primary/30'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="text-center space-y-8">
              {uploadedFiles.length > 0 ? (
                <div className="space-y-8">
                  <CheckCircle className="w-14 h-14 text-accent mx-auto" />
                  <div>
                    <h3 className="text-xl font-medium text-accent mb-3">Files Uploaded Successfully!</h3>
                    <p className="text-muted-foreground">Your notes have been processed and are ready for learning.</p>
                  </div>
                  
                  <div className="space-y-4">
                    {uploadedFiles.map((file, index) => (
                      <div key={index} className="flex items-center justify-between p-4 bg-accent-soft rounded-xl">
                        <div className="flex items-center gap-4">
                          <FileText className="w-5 h-5 text-accent" />
                          <div>
                            <span className="font-medium">{file.title}</span>
                            <p className="text-sm text-muted-foreground">{file.file_name}</p>
                          </div>
                        </div>
                        <CheckCircle className="w-5 h-5 text-accent" />
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-6 justify-center">
                    <Button variant="learning" size="lg">
                      Start SmartLearn
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="lg">
                      Ask Questions
                    </Button>
                  </div>
                </div>
              ) : isProcessing ? (
                <div className="space-y-8">
                  <div className="w-14 h-14 bg-primary/8 rounded-full flex items-center justify-center mx-auto animate-glow">
                    <Upload className="w-7 h-7 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium mb-3">Processing Your Notes...</h3>
                    <p className="text-muted-foreground mb-6">AI is analyzing and structuring your content</p>
                    <Progress value={uploadProgress} className="w-full max-w-sm mx-auto" />
                    <p className="text-sm text-muted-foreground mt-3">{uploadProgress}% complete</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="w-14 h-14 bg-primary/8 rounded-full flex items-center justify-center mx-auto">
                    <Upload className="w-7 h-7 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium mb-3">Drop your files here</h3>
                    <p className="text-muted-foreground">or click to browse</p>
                  </div>
                  
                  <Button variant="learning" size="lg" onClick={handleFileSelect}>
                    <Upload className="w-4 h-4" />
                    Choose Files
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.docx,.jpg,.jpeg,.png,.txt"
                    onChange={handleFileInputChange}
                  />
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-lg mx-auto">
                    <div className="flex items-center gap-3 p-4 bg-muted rounded-xl">
                      <FileText className="w-4 h-4 text-primary" />
                      <span className="text-sm">PDF</span>
                    </div>
                    <div className="flex items-center gap-3 p-4 bg-muted rounded-xl">
                      <Image className="w-4 h-4 text-primary" />
                      <span className="text-sm">JPG</span>
                    </div>
                    <div className="flex items-center gap-3 p-4 bg-muted rounded-xl">
                      <FileText className="w-4 h-4 text-primary" />
                      <span className="text-sm">DOCX</span>
                    </div>
                    <div className="flex items-center gap-3 p-4 bg-muted rounded-xl">
                      <Image className="w-4 h-4 text-primary" />
                      <span className="text-sm">PNG</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
};

export default UploadSection;