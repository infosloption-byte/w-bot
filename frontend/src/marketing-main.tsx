import React from "react";
import { createRoot } from "react-dom/client";
import { currentPage, Header, Footer } from "./marketing-shared.js";
import { Home, Translation, Alerts } from "./marketing-home.js";
import { Pricing, HowItWorks, FAQ, Contact } from "./marketing-info.js";
import { Trust } from "./marketing-trust.js";
import "./marketing.css";

function MarketingApp() {
  return <div className="site">
    <a href="#site-main" className="site-skip-link">Skip to content</a>
    <Header page={currentPage}/>
    <main id="site-main">
      {currentPage === "home" && <Home/>}
      {currentPage === "translation" && <Translation/>}
      {currentPage === "alerts" && <Alerts/>}
      {currentPage === "pricing" && <Pricing/>}
      {currentPage === "how" && <HowItWorks/>}
      {currentPage === "faq" && <FAQ/>}
      {currentPage === "contact" && <Contact/>}
      {currentPage === "trust" && <Trust/>}
    </main>
    <Footer/>
  </div>;
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<MarketingApp/>);
