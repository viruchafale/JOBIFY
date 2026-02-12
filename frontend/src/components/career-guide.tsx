"use client"
import { Sparkles } from 'lucide-react'
import React from 'react'

const CareerGuide = () => {
  return (
    <div className='max-w-7xl mx-auto px-4 py-16'>
      <div className="text-center mb-12">
        <div className='inline-flex items-center gap-2 px-4 py-2 rounded-full border bg-blue-50 dark:bg-blue-950 mb-4'>
          <Sparkles size={16} className='text-blue-600' />
          <span className="text-sm font-medium"> AI-Powered Career Guidance</span>

        </div>
        <h2 className="text-3xl md:text-4xl font-bold mb-4">
          Discover Your Career Path
        </h2>
        <p className='text-lg opacity-70 max-w-2xl mx-auto mb-8'>get personalzed job recommendation and learning roadmaps based on your skills</p>
      </div>
    </div>
  )
}

export default CareerGuide