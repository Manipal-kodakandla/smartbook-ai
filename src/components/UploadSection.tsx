import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, Image, CheckCircle, ArrowRight } from "lucide-react";
import { useState } from "react";

const UploadSection = () => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);

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
    simulateUpload();
  };

  const simulateUpload = () => {
    setIsProcessing(true);
    setUploadProgress(0);
    
    const interval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsProcessing(false);
          setUploadedFiles(["Mathematics_Notes.pdf", "Physics_Chapter3.jpg"]);
          return 100;
        }
        return prev + 10;
      });
    }, 200);
  };

  return (
    <section id="upload" className="py-20 bg-secondary/30">
      <div className="container mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold mb-4">Upload Your Notes</h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Support for handwritten notes, PDFs, images, and documents. Our AI processes everything with precision.
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          <Card 
            className={`p-8 border-2 border-dashed transition-all duration-300 ${
              isDragOver 
                ? 'border-primary bg-primary/5 shadow-glow' 
                : 'border-border hover:border-primary/50'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="text-center space-y-6">
              {uploadedFiles.length > 0 ? (
                <div className="space-y-6">
                  <CheckCircle className="w-16 h-16 text-accent mx-auto" />
                  <div>
                    <h3 className="text-2xl font-semibold text-accent mb-2">Files Uploaded Successfully!</h3>
                    <p className="text-muted-foreground">Your notes have been processed and are ready for learning.</p>
                  </div>
                  
                  <div className="space-y-3">
                    {uploadedFiles.map((file, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-accent-soft rounded-lg">
                        <div className="flex items-center gap-3">
                          <FileText className="w-5 h-5 text-accent" />
                          <span className="font-medium">{file}</span>
                        </div>
                        <CheckCircle className="w-5 h-5 text-accent" />
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-4 justify-center">
                    <Button variant="learning" size="lg">
                      Start SmartLearn
                      <ArrowRight className="w-5 h-5" />
                    </Button>
                    <Button variant="outline" size="lg">
                      Ask Questions
                    </Button>
                  </div>
                </div>
              ) : isProcessing ? (
                <div className="space-y-6">
                  <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto animate-glow">
                    <Upload className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2">Processing Your Notes...</h3>
                    <p className="text-muted-foreground mb-4">AI is analyzing and structuring your content</p>
                    <Progress value={uploadProgress} className="w-full max-w-sm mx-auto" />
                    <p className="text-sm text-muted-foreground mt-2">{uploadProgress}% complete</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                    <Upload className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2">Drop your files here</h3>
                    <p className="text-muted-foreground">or click to browse</p>
                  </div>
                  
                  <Button variant="learning" size="lg" onClick={simulateUpload}>
                    <Upload className="w-5 h-5" />
                    Choose Files
                  </Button>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-lg mx-auto">
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                      <FileText className="w-5 h-5 text-primary" />
                      <span className="text-sm">PDF</span>
                    </div>
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                      <Image className="w-5 h-5 text-primary" />
                      <span className="text-sm">JPG</span>
                    </div>
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                      <FileText className="w-5 h-5 text-primary" />
                      <span className="text-sm">DOCX</span>
                    </div>
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                      <Image className="w-5 h-5 text-primary" />
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