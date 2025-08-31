import Navigation from "@/components/Navigation";
import Hero from "@/components/Hero";
import UploadSection from "@/components/UploadSection";
import SmartLearnDemo from "@/components/SmartLearnDemo";
import QADemo from "@/components/QADemo";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { documentService, type Document } from "@/services/documentService";

const Index = () => {
  const [userDocuments, setUserDocuments] = useState<Document[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<Document | undefined>();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      loadUserDocuments();
    }
  }, [user]);

  const loadUserDocuments = async () => {
    if (!user) return;
    try {
      const docs = await documentService.getUserDocuments(user.id);
      setUserDocuments(docs);
      if (docs.length > 0 && !selectedDocument) {
        setSelectedDocument(docs[0]);
      }
    } catch (error) {
      console.error('Failed to load documents:', error);
    }
  };

  const handleDocumentUploaded = (document: Document) => {
    setUserDocuments(prev => [document, ...prev]);
    setSelectedDocument(document);
  };

  return (
    <div className="min-h-screen">
      <Navigation />
      <main>
        <Hero />
        <UploadSection onDocumentUploaded={handleDocumentUploaded} />
        <SmartLearnDemo selectedDocument={selectedDocument} />
        <QADemo userDocuments={userDocuments} />
      </main>
    </div>
  );
};

export default Index;
